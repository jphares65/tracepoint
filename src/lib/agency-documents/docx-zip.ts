import { crc32, deflateRawSync, inflateRawSync } from "node:zlib";

/**
 * Minimal ZIP reader/writer for .docx packages, built on node:zlib so no new
 * dependency is needed. Unchanged entries are copied byte-for-byte (same
 * compressed data and CRC); only replaced entries are re-compressed. That keeps
 * every part of the Word file we do not touch identical to the agency's original.
 *
 * Deliberately strict: ZIP64, encryption, and unusual compression methods are
 * rejected with a readable error rather than handled partially.
 */

export type ZipEntry = {
  name: string;
  method: number;
  crc: number;
  compressedSize: number;
  uncompressedSize: number;
  flags: number;
  modTime: number;
  modDate: number;
  externalAttributes: number;
  versionMadeBy: number;
  compressed: Uint8Array;
};

export class ZipFormatError extends Error {
  constructor(message: string) { super(message); this.name = "ZipFormatError"; }
}

const MAX_ENTRIES = 2000;
const MAX_TOTAL_UNCOMPRESSED = 80 * 1024 * 1024;

function view(bytes: Uint8Array) { return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); }

export function readZip(bytes: Uint8Array): ZipEntry[] {
  if (bytes.length < 22) throw new ZipFormatError("The file is not a valid Word document.");
  const dv = view(bytes);
  let eocd = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 22 - 65535); offset -= 1) {
    if (dv.getUint32(offset, true) === 0x06054b50) { eocd = offset; break; }
  }
  if (eocd < 0) throw new ZipFormatError("The file is not a valid Word document.");
  const count = dv.getUint16(eocd + 10, true);
  const cdSize = dv.getUint32(eocd + 12, true);
  const cdOffset = dv.getUint32(eocd + 16, true);
  if (count === 0xffff || cdOffset === 0xffffffff || cdSize === 0xffffffff) throw new ZipFormatError("Very large Word documents (ZIP64) are not supported.");
  if (count > MAX_ENTRIES) throw new ZipFormatError("The Word document has too many parts.");
  if (cdOffset + cdSize > bytes.length) throw new ZipFormatError("The Word document is damaged.");
  const entries: ZipEntry[] = [];
  let pointer = cdOffset, total = 0;
  const decoder = new TextDecoder("utf-8");
  for (let index = 0; index < count; index += 1) {
    if (dv.getUint32(pointer, true) !== 0x02014b50) throw new ZipFormatError("The Word document is damaged.");
    const versionMadeBy = dv.getUint16(pointer + 4, true);
    const flags = dv.getUint16(pointer + 8, true);
    const method = dv.getUint16(pointer + 10, true);
    const modTime = dv.getUint16(pointer + 12, true);
    const modDate = dv.getUint16(pointer + 14, true);
    const crc = dv.getUint32(pointer + 16, true);
    const compressedSize = dv.getUint32(pointer + 20, true);
    const uncompressedSize = dv.getUint32(pointer + 24, true);
    const nameLength = dv.getUint16(pointer + 28, true);
    const extraLength = dv.getUint16(pointer + 30, true);
    const commentLength = dv.getUint16(pointer + 32, true);
    const externalAttributes = dv.getUint32(pointer + 38, true);
    const localOffset = dv.getUint32(pointer + 42, true);
    const name = decoder.decode(bytes.subarray(pointer + 46, pointer + 46 + nameLength));
    if (flags & 0x1) throw new ZipFormatError("Password-protected Word documents are not supported. Save an unprotected copy.");
    if (method !== 0 && method !== 8) throw new ZipFormatError("The Word document uses an unsupported compression method.");
    if (name.includes("..") || name.startsWith("/")) throw new ZipFormatError("The Word document contains an invalid part name.");
    total += uncompressedSize;
    if (total > MAX_TOTAL_UNCOMPRESSED) throw new ZipFormatError("The Word document is too large when uncompressed.");
    if (dv.getUint32(localOffset, true) !== 0x04034b50) throw new ZipFormatError("The Word document is damaged.");
    const localName = dv.getUint16(localOffset + 26, true), localExtra = dv.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localName + localExtra;
    if (dataStart + compressedSize > bytes.length) throw new ZipFormatError("The Word document is damaged.");
    entries.push({ name, method, crc, compressedSize, uncompressedSize, flags, modTime, modDate, externalAttributes, versionMadeBy, compressed: bytes.subarray(dataStart, dataStart + compressedSize) });
    pointer += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

export function entryBytes(entry: ZipEntry): Uint8Array {
  const data = entry.method === 0 ? entry.compressed : new Uint8Array(inflateRawSync(entry.compressed, { maxOutputLength: MAX_TOTAL_UNCOMPRESSED }));
  if (data.length !== entry.uncompressedSize || (crc32(data) >>> 0) !== entry.crc >>> 0) throw new ZipFormatError(`The Word document part ${entry.name} is damaged.`);
  return data;
}

export function entryText(entry: ZipEntry) {
  return new TextDecoder("utf-8").decode(entryBytes(entry));
}

/** Rebuild the package, replacing the named parts. Order and metadata of all other parts are preserved. */
export function writeZip(entries: readonly ZipEntry[], replacements: ReadonlyMap<string, string | Uint8Array> = new Map()): Uint8Array {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const original of entries) {
    let entry = original;
    const replacement = replacements.get(original.name);
    if (replacement !== undefined) {
      const raw = typeof replacement === "string" ? encoder.encode(replacement) : replacement;
      const compressed = new Uint8Array(deflateRawSync(raw, { level: 6 }));
      entry = { ...original, method: 8, crc: crc32(raw) >>> 0, compressedSize: compressed.length, uncompressedSize: raw.length, compressed };
    }
    const name = encoder.encode(entry.name);
    const utf8 = /[^\x20-\x7e]/.test(entry.name) ? 0x800 : 0;
    const flags = (entry.flags & ~0x8 & ~0x800) | utf8; // sizes are written up front, so no data descriptor
    const local = new Uint8Array(30 + name.length);
    const lv = view(local);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, flags, true); lv.setUint16(8, entry.method, true);
    lv.setUint16(10, entry.modTime, true); lv.setUint16(12, entry.modDate, true); lv.setUint32(14, entry.crc, true);
    lv.setUint32(18, entry.compressedSize, true); lv.setUint32(22, entry.uncompressedSize, true); lv.setUint16(26, name.length, true); lv.setUint16(28, 0, true);
    local.set(name, 30);
    const header = new Uint8Array(46 + name.length);
    const hv = view(header);
    hv.setUint32(0, 0x02014b50, true); hv.setUint16(4, entry.versionMadeBy || 20, true); hv.setUint16(6, 20, true); hv.setUint16(8, flags, true);
    hv.setUint16(10, entry.method, true); hv.setUint16(12, entry.modTime, true); hv.setUint16(14, entry.modDate, true); hv.setUint32(16, entry.crc, true);
    hv.setUint32(20, entry.compressedSize, true); hv.setUint32(24, entry.uncompressedSize, true); hv.setUint16(28, name.length, true);
    hv.setUint32(38, entry.externalAttributes, true); hv.setUint32(42, offset, true);
    header.set(name, 46);
    chunks.push(local, entry.compressed);
    central.push(header);
    offset += local.length + entry.compressed.length;
  }
  const cdSize = central.reduce((sum, chunk) => sum + chunk.length, 0);
  const end = new Uint8Array(22);
  const ev = view(end);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, entries.length, true); ev.setUint16(10, entries.length, true); ev.setUint32(12, cdSize, true); ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + cdSize + 22);
  let position = 0;
  for (const chunk of [...chunks, ...central, end]) { out.set(chunk, position); position += chunk.length; }
  return out;
}

/** Build a new package from scratch (used by tests to create synthetic Word forms). */
export function createZip(files: ReadonlyArray<[string, string | Uint8Array]>): Uint8Array {
  const encoder = new TextEncoder();
  const entries: ZipEntry[] = files.map(([name, content]) => {
    const raw = typeof content === "string" ? encoder.encode(content) : content;
    const compressed = new Uint8Array(deflateRawSync(raw));
    return { name, method: 8, crc: crc32(raw) >>> 0, compressedSize: compressed.length, uncompressedSize: raw.length, flags: 0, modTime: 0, modDate: 0x21, externalAttributes: 0, versionMadeBy: 20, compressed };
  });
  return writeZip(entries);
}
