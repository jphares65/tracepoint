import { entryText, readZip, writeZip, ZipFormatError, type ZipEntry } from "./docx-zip";

/**
 * Word (.docx) form support: find the places a form expects information and
 * fill them in place, so the completed file keeps the agency's own layout,
 * fonts, headers and styles exactly.
 *
 * Recognized places (all deterministic):
 * - merge tokens:        {{Officer Name}}  or  «Officer Name»
 * - label + blank line:  "Badge Number: __________"   (also ___/___/____ date blanks)
 * - table cells:         a label cell followed by an empty cell, or a header row over an empty row
 * - content controls:    Word "Plain Text" / "Rich Text" / date controls (title or tag is the label)
 * - legacy text fields:  FORMTEXT fields (label from the field name or the text before it)
 *
 * Every place gets a locator {part, kind, ordinal, label}. The template file is
 * immutable per version, so the same locator always finds the same spot; the
 * label is re-checked on fill and a mismatch is reported instead of guessed.
 */

export type DocxTargetKind = "token" | "label_blank" | "table_cell" | "content_control" | "legacy_field";
export type DocxTarget = { part: string; kind: DocxTargetKind; ordinal: number; label: string };
export type DocxField = DocxTarget & { context: string; /** First row of a multi-row list — may not be about a single record. */ repeating?: boolean; /** Nearest heading above the field (e.g. "SUPERVISOR INFORMATION"), used to spot fields about someone else. */ section?: string };
export type DocxFill = { target: DocxTarget; value: string; fieldId?: string; label?: string };
export type DocxIssue = { fieldId?: string; label?: string; kind: "target_missing" | "target_changed"; message: string };

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export { DOCX_MIME };

export class DocxFormError extends Error {
  constructor(message: string) { super(message); this.name = "DocxFormError"; }
}

export function looksLikeDocx(bytes: Uint8Array) {
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

// ---------------------------------------------------------------- XML helpers

export function decodeXml(text: string) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, entity: string) => {
    const lower = entity.toLowerCase();
    if (lower === "amp") return "&"; if (lower === "lt") return "<"; if (lower === "gt") return ">"; if (lower === "quot") return "\""; if (lower === "apos") return "'";
    const code = lower.startsWith("#x") ? parseInt(lower.slice(2), 16) : parseInt(lower.slice(1), 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : "";
  });
}

export function escapeXml(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Text for a w:t element, with line breaks for multi-line values. */
function textElements(value: string) {
  return value.split(/\r?\n/).map((line) => `<w:t xml:space="preserve">${escapeXml(line)}</w:t>`).join("<w:br/>");
}

type TextNode = { start: number; end: number; text: string };

/** All <w:t> elements between start and end (absolute offsets into xml). Tabs and breaks count as characters. */
function textNodes(xml: string, start: number, end: number): TextNode[] {
  const nodes: TextNode[] = [];
  const pattern = /<w:t(?:\s[^>]*)?\/>|<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br(?:\s[^>]*)?\/>/g;
  pattern.lastIndex = start;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(xml)) && match.index < end) {
    const raw = match[0];
    if (raw.startsWith("<w:tab")) nodes.push({ start: match.index, end: match.index + raw.length, text: "\t" });
    else if (raw.startsWith("<w:br")) nodes.push({ start: match.index, end: match.index + raw.length, text: "\n" });
    else nodes.push({ start: match.index, end: match.index + raw.length, text: raw.endsWith("/>") ? "" : decodeXml(match[1] ?? "") });
  }
  return nodes;
}

type Edit = { start: number; end: number; replacement: string };

/** Replace characters [from, to) of the concatenated node text with value, keeping each run's formatting. */
function replaceTextRange(nodes: TextNode[], from: number, to: number, value: string): Edit[] {
  const edits: Edit[] = [];
  let cursor = 0, placed = false;
  for (const node of nodes) {
    const nodeStart = cursor, nodeEnd = cursor + node.text.length;
    cursor = nodeEnd;
    if (nodeEnd <= from || nodeStart >= to) continue;
    if (!node.text.length) continue;
    const isText = !(node.text === "\t" || node.text === "\n") || nodes.length === 1;
    const before = node.text.slice(0, Math.max(0, from - nodeStart));
    const after = node.text.slice(Math.max(0, to - nodeStart));
    if (!isText) { edits.push({ start: node.start, end: node.end, replacement: placed ? "" : textElements(value) }); placed = true; continue; }
    const middle = placed ? "" : value;
    placed = true;
    edits.push({ start: node.start, end: node.end, replacement: textElements(before + middle + after) });
  }
  return edits;
}

function applyEdits(xml: string, edits: Edit[]) {
  const sorted = [...edits].sort((a, b) => b.start - a.start);
  let out = xml, lastStart = Infinity;
  for (const edit of sorted) {
    if (edit.end > lastStart) throw new DocxFormError("Two fields overlap in the Word document.");
    out = out.slice(0, edit.start) + edit.replacement + out.slice(edit.end);
    lastStart = edit.start;
  }
  return out;
}

type Block = { start: number; end: number; inner: number; innerEnd: number };

/** Find balanced elements of a tag (handles nesting, e.g. tables inside tables). */
function elements(xml: string, tag: string, start = 0, end = xml.length): Block[] {
  const blocks: Block[] = [];
  const open = new RegExp(`<${tag}(?=[\\s>/])[^>]*?(/?)>|</${tag}>`, "g");
  open.lastIndex = start;
  const stack: { start: number; inner: number }[] = [];
  let match: RegExpExecArray | null;
  while ((match = open.exec(xml)) && match.index < end) {
    if (match[0].startsWith("</")) {
      const top = stack.pop();
      if (top && stack.length === 0) blocks.push({ start: top.start, end: match.index + match[0].length, inner: top.inner, innerEnd: match.index });
      else if (top) continue;
    } else if (match[1] === "/") {
      if (stack.length === 0) blocks.push({ start: match.index, end: match.index + match[0].length, inner: match.index + match[0].length, innerEnd: match.index + match[0].length });
    } else {
      stack.push({ start: match.index, inner: match.index + match[0].length });
    }
  }
  return blocks;
}

function plainText(xml: string, start: number, end: number) {
  return textNodes(xml, start, end).map((node) => node.text).join("");
}

function cleanLabel(raw: string) {
  return raw.replace(/[\t\n]+/g, " ").replace(/\s+/g, " ").replace(/^[\s:.\-–—|•]+|[\s:.\-–—|•]+$/g, "").replace(/\s*\(\s*\)\s*$/, "").trim();
}

function plausibleLabel(label: string) {
  return label.length >= 2 && label.length <= 60 && /[a-z]/i.test(label) && label.split(/\s+/).length <= 8;
}

// ---------------------------------------------------------------- detection

type Candidate = DocxField & { edit: (value: string) => Edit[]; position: number };

const BLANK = /_{3,}(?:\s*\/\s*_{2,}){0,2}/g;
const TOKEN = /\{\{\s*([^{}]{1,80}?)\s*\}\}|«([^«»]{1,80})»/g;

function paragraphCandidates(xml: string, part: string, paragraph: Block, counters: Record<DocxTargetKind, number>, skip: (start: number, end: number) => boolean): Candidate[] {
  const out: Candidate[] = [];
  // Paragraphs that are part of a content control or legacy field result are handled by those detectors.
  if (skip(paragraph.start, paragraph.end)) return out;
  const nodes = textNodes(xml, paragraph.inner, paragraph.innerEnd);
  const text = nodes.map((node) => node.text).join("");
  if (!text.trim()) return out;
  for (const match of text.matchAll(TOKEN)) {
    const label = cleanLabel(match[1] ?? match[2] ?? "");
    if (!label) continue;
    const from = match.index!, to = from + match[0].length;
    out.push({ part, kind: "token", ordinal: counters.token++, label, position: paragraph.start, context: text.trim().slice(0, 120), edit: (value) => replaceTextRange(nodes, from, to, value) });
  }
  let previousEnd = 0;
  for (const match of text.matchAll(BLANK)) {
    const from = match.index!, to = from + match[0].length;
    const preceding = text.slice(previousEnd, from);
    previousEnd = to;
    // The label is the text right before the blank, after any earlier separator.
    const label = cleanLabel(preceding.split(/\t|\s{3,}|;|\|/).at(-1) ?? "");
    if (!plausibleLabel(label)) continue;
    out.push({ part, kind: "label_blank", ordinal: counters.label_blank++, label, position: paragraph.start, context: text.trim().slice(0, 120), edit: (value) => replaceTextRange(nodes, from, to, value) });
  }
  return out;
}

function firstRunProperties(xml: string, start: number, end: number) {
  const slice = xml.slice(start, end);
  const paragraphMark = slice.match(/<w:pPr>[\s\S]*?(<w:rPr>[\s\S]*?<\/w:rPr>)[\s\S]*?<\/w:pPr>/);
  const run = slice.match(/<w:r(?:\s[^>]*)?>\s*(<w:rPr>[\s\S]*?<\/w:rPr>)/);
  return (paragraphMark?.[1] ?? run?.[1] ?? "").replace(/<w:rStyle w:val="PlaceholderText"\/>/g, "");
}

/** Edit that writes value into an empty table cell's first paragraph. */
function fillEmptyCell(xml: string, cell: Block, labelCell: Block | null): (value: string) => Edit[] {
  return (value) => {
    const paragraphs = elements(xml, "w:p", cell.inner, cell.innerEnd);
    const rPr = firstRunProperties(xml, paragraphs[0]?.start ?? cell.inner, paragraphs[0]?.end ?? cell.innerEnd) || (labelCell ? firstRunProperties(xml, labelCell.inner, labelCell.innerEnd) : "");
    const run = `<w:r>${rPr}${textElements(value)}</w:r>`;
    const paragraph = paragraphs[0];
    if (!paragraph) return [{ start: cell.innerEnd, end: cell.innerEnd, replacement: `<w:p>${run}</w:p>` }];
    if (paragraph.inner === paragraph.innerEnd && xml.slice(paragraph.start, paragraph.end).endsWith("/>")) return [{ start: paragraph.start, end: paragraph.end, replacement: `<w:p>${run}</w:p>` }];
    const pPr = elements(xml, "w:pPr", paragraph.inner, paragraph.innerEnd)[0];
    const at = pPr ? pPr.end : paragraph.inner;
    // Remove any empty runs so the value is the only content.
    return [{ start: at, end: paragraph.innerEnd, replacement: run }];
  };
}

/** Content other than text that makes a cell "not empty" (checkbox symbols, images, fields, controls). */
const NON_TEXT_CONTENT = /<w:sym\b|<w:drawing\b|<w:pict\b|<w:object\b|<w:fldChar\b|<w:fldSimple\b|<w:sdt\b|<mc:AlternateContent\b/;

function tableCandidates(xml: string, part: string, table: Block, counters: Record<DocxTargetKind, number>, used: Set<number>, reserved: (start: number, end: number) => boolean): Candidate[] {
  const out: Candidate[] = [];
  const rows = elements(xml, "w:tr", table.inner, table.innerEnd).map((row) => elements(xml, "w:tc", row.inner, row.innerEnd));
  const rawTexts = rows.map((cells) => cells.map((cell) => plainText(xml, cell.inner, cell.innerEnd).trim()));
  // A vertically merged continuation cell is part of the cell above it; it is neither a label nor a place to write.
  const continuation = (cell: Block) => /<w:vMerge(?:\s+w:val="continue")?\s*\/>/.test(xml.slice(cell.inner, elements(xml, "w:tcPr", cell.inner, cell.innerEnd)[0]?.end ?? cell.inner));
  const unusable = (cell: Block) => continuation(cell) || NON_TEXT_CONTENT.test(xml.slice(cell.inner, cell.innerEnd)) || reserved(cell.start, cell.end);
  // Treat unusable cells as non-empty text so they are never filled and never pair with a label.
  const texts = rawTexts.map((cells, r) => cells.map((text, c) => (text === "" && unusable(rows[r][c]) ? "\u0000" : text)));
  const nested = (cell: Block) => elements(xml, "w:tbl", cell.inner, cell.innerEnd).length > 0;
  rows.forEach((cells, r) => {
    // Horizontal: [Label][empty]
    for (let c = 0; c + 1 < cells.length; c += 1) {
      const label = cleanLabel(texts[r][c]);
      if (unusable(cells[c]) || /_{3,}/.test(texts[r][c]) || !plausibleLabel(label) || texts[r][c + 1] !== "" || used.has(cells[c + 1].start) || nested(cells[c + 1])) continue;
      used.add(cells[c + 1].start);
      out.push({ part, kind: "table_cell", ordinal: counters.table_cell++, label, position: cells[c].start, context: `Table row: ${texts[r].filter(Boolean).join(" | ").slice(0, 100)}`, edit: fillEmptyCell(xml, cells[c + 1], cells[c]) });
    }
    // Vertical: a label cell whose cell directly below is empty (header row over an entry row).
    const below = rows[r + 1];
    if (!below || below.length !== cells.length) return;
    // Several empty rows of the same shape below a header usually mean a roster/list; flag those for review.
    let emptyRows = 0;
    for (let next = r + 1; next < rows.length && rows[next].length === cells.length && texts[next].every((value) => value === ""); next += 1) emptyRows += 1;
    cells.forEach((cell, c) => {
      const label = cleanLabel(texts[r][c]);
      if (unusable(cell) || /_{3,}/.test(texts[r][c]) || !plausibleLabel(label)) return;
      if (texts[r + 1][c] !== "" || used.has(below[c].start) || nested(below[c])) return;
      // A label already paired with the empty cell to its right is not also paired downward.
      if (c + 1 < cells.length && texts[r][c + 1] === "" && used.has(cells[c + 1].start)) return;
      used.add(below[c].start);
      out.push({ part, kind: "table_cell", ordinal: counters.table_cell++, label, position: cell.start, repeating: emptyRows > 1, context: emptyRows > 1 ? `First row of a ${emptyRows}-row list under "${label}"` : `Table column: ${label}`, edit: fillEmptyCell(xml, below[c], cell) });
    });
  });
  return out;
}

function contentControlCandidates(xml: string, part: string, counters: Record<DocxTargetKind, number>): { candidates: Candidate[]; ranges: Array<[number, number]> } {
  const candidates: Candidate[] = [], ranges: Array<[number, number]> = [];
  for (const sdt of elements(xml, "w:sdt")) {
    ranges.push([sdt.start, sdt.end]);
    const prBlock = elements(xml, "w:sdtPr", sdt.inner, sdt.innerEnd)[0];
    const content = elements(xml, "w:sdtContent", sdt.inner, sdt.innerEnd)[0];
    if (!prBlock || !content) continue;
    const pr = xml.slice(prBlock.start, prBlock.end);
    if (/<w14:checkbox|<w:dropDownList|<w:comboBox|<w:picture|<w:docPartObj|<w:group\b/.test(pr)) continue;
    if (elements(xml, "w:tbl", content.inner, content.innerEnd).length) continue;
    const alias = pr.match(/<w:alias w:val="([^"]*)"/)?.[1], tag = pr.match(/<w:tag w:val="([^"]*)"/)?.[1];
    const placeholder = /<w:showingPlcHdr\/>/.test(pr) ? plainText(xml, content.inner, content.innerEnd) : "";
    const label = cleanLabel(decodeXml(alias || tag || placeholder || ""));
    if (!plausibleLabel(label)) continue;
    const nodes = textNodes(xml, content.inner, content.innerEnd);
    const total = nodes.reduce((sum, node) => sum + node.text.length, 0);
    candidates.push({
      part, kind: "content_control", ordinal: counters.content_control++, label, position: sdt.start, context: `Content control: ${label}`,
      edit: (value) => {
        const edits: Edit[] = [];
        const placeholderFlag = pr.indexOf("<w:showingPlcHdr/>");
        // Clearing is only for placeholder prompts; designed default text is left alone.
        if (!value && placeholderFlag < 0) return edits;
        if (placeholderFlag >= 0) edits.push({ start: prBlock.start + placeholderFlag, end: prBlock.start + placeholderFlag + "<w:showingPlcHdr/>".length, replacement: "" });
        if (nodes.length) {
          edits.push(...replaceTextRange(nodes, 0, total, value));
          // Placeholder text is usually styled grey; drop that style from the content's runs.
          const styleMatches = [...xml.slice(content.inner, content.innerEnd).matchAll(/<w:rStyle w:val="PlaceholderText"\/>/g)];
          for (const style of styleMatches) {
            const start = content.inner + style.index!;
            if (!edits.some((edit) => start >= edit.start && start < edit.end)) edits.push({ start, end: start + style[0].length, replacement: "" });
          }
        } else {
          const paragraph = elements(xml, "w:p", content.inner, content.innerEnd)[0];
          const insertAt = paragraph ? (elements(xml, "w:pPr", paragraph.inner, paragraph.innerEnd)[0]?.end ?? paragraph.inner) : content.inner;
          if (value) edits.push({ start: insertAt, end: insertAt, replacement: `<w:r>${textElements(value)}</w:r>` });
        }
        return edits;
      },
    });
  }
  return { candidates, ranges };
}

function legacyFieldCandidates(xml: string, part: string, counters: Record<DocxTargetKind, number>): { candidates: Candidate[]; ranges: Array<[number, number]> } {
  const candidates: Candidate[] = [], ranges: Array<[number, number]> = [];
  for (const paragraph of elements(xml, "w:p")) {
    const body = xml.slice(paragraph.start, paragraph.end);
    if (!/FORM(TEXT|CHECKBOX|DROPDOWN)/.test(body)) continue;
    ranges.push([paragraph.start, paragraph.end]);
    // Walk field characters in order. Each field is begin … [separate …] end; checkboxes have no separate.
    const token = /<w:fldChar\b[^>]*?w:fldCharType="(begin|separate|end)"[^>]*?(?:\/>|>([\s\S]*?)<\/w:fldChar>)|<w:instrText\b[^>]*>([^<]*)<\/w:instrText>/g;
    type Open = { begin: number; ffData: string; instr: string; separateEnd: number | null; depth: number };
    const stack: Open[] = [];
    // The label for a field is the text after the previous field in the same paragraph.
    let previousFieldEnd = paragraph.inner;
    let match: RegExpExecArray | null;
    while ((match = token.exec(body))) {
      const at = paragraph.start + match.index;
      if (match[3] !== undefined) { if (stack.length) stack[stack.length - 1]!.instr += decodeXml(match[3]); continue; }
      if (match[1] === "begin") stack.push({ begin: at, ffData: match[2] ?? "", instr: "", separateEnd: null, depth: stack.length });
      else if (match[1] === "separate") { if (stack.length) stack[stack.length - 1]!.separateEnd = at + match[0].length; }
      else {
        const field = stack.pop();
        if (!field || field.depth !== 0) continue;
        const labelFrom = previousFieldEnd;
        previousFieldEnd = at + match[0].length;
        if (!/\bFORMTEXT\b/.test(field.instr) || field.separateEnd === null) continue;
        const resultStart = field.separateEnd, resultEnd = at;
        const name = cleanLabel(field.ffData.match(/<w:name w:val="([^"]*)"/)?.[1] ?? "");
        const before = cleanLabel(plainText(xml, labelFrom, field.begin).split(/\t|\s{3,}|;|\|/).at(-1) ?? "");
        const label = name && !/^(text|check|dropdown)\d*$/i.test(name) ? name : before;
        if (!plausibleLabel(label)) continue;
        const nodes = textNodes(xml, resultStart, resultEnd);
        const total = nodes.reduce((sum, node) => sum + node.text.length, 0);
        candidates.push({ part, kind: "legacy_field", ordinal: counters.legacy_field++, label, position: field.begin, context: `Form field: ${label}`, edit: (value) => (nodes.length ? replaceTextRange(nodes, 0, total, value) : value ? [{ start: resultStart, end: resultStart, replacement: `<w:r>${textElements(value)}</w:r>` }] : []) });
      }
    }
  }
  return { candidates, ranges };
}

/** Body plus headers and footers, in a stable order. */
function formParts(entries: readonly ZipEntry[]) {
  const names = entries.map((entry) => entry.name);
  const order = (name: string) => (name === "word/document.xml" ? 0 : name.startsWith("word/header") ? 1 : 2);
  return names.filter((name) => name === "word/document.xml" || /^word\/(header|footer)\d*\.xml$/.test(name)).sort((a, b) => order(a) - order(b) || a.localeCompare(b, "en", { numeric: true }));
}

/** Short paragraphs with no blanks or placeholders, and single-cell table rows: candidates for section headings. */
function headings(xml: string) {
  const found: Array<{ position: number; text: string }> = [];
  const tables = elements(xml, "w:tbl");
  for (const paragraph of elements(xml, "w:p")) {
    const text = cleanLabel(plainText(xml, paragraph.inner, paragraph.innerEnd));
    if (!text || text.length > 60 || /_{3,}|\{\{|«|:\s*\S/.test(text)) continue;
    const inTable = tables.find((table) => paragraph.start > table.start && paragraph.end < table.end);
    if (inTable) {
      // Inside a table only a row that is a single (merged) cell counts as a heading.
      const row = elements(xml, "w:tr", inTable.inner, inTable.innerEnd).find((item) => paragraph.start > item.start && paragraph.end < item.end);
      if (!row || elements(xml, "w:tc", row.inner, row.innerEnd).length !== 1) continue;
    }
    found.push({ position: paragraph.start, text });
  }
  return found;
}

function detectPart(xml: string, part: string): Candidate[] {
  const counters: Record<DocxTargetKind, number> = { token: 0, label_blank: 0, table_cell: 0, content_control: 0, legacy_field: 0 };
  const controls = contentControlCandidates(xml, part, counters);
  const legacy = legacyFieldCandidates(xml, part, counters);
  const reservedRanges = [...controls.ranges, ...legacy.ranges];
  const reserved = (start: number, end: number) => reservedRanges.some(([a, b]) => start < b && end > a);
  const used = new Set<number>();
  const tables = elements(xml, "w:tbl").flatMap((table) => tableCandidates(xml, part, table, counters, used, reserved));
  const paragraphs = elements(xml, "w:p").flatMap((paragraph) => paragraphCandidates(xml, part, paragraph, counters, reserved));
  const titles = headings(xml);
  return [...controls.candidates, ...legacy.candidates, ...tables, ...paragraphs].map((candidate) => {
    const section = [...titles].reverse().find((title) => title.position < candidate.position && title.text !== candidate.label)?.text;
    return section ? { ...candidate, section } : candidate;
  });
}

function loadParts(bytes: Uint8Array) {
  if (!looksLikeDocx(bytes)) throw new DocxFormError("The file is not a Word (.docx) document. Older .doc files must be saved as .docx first.");
  let entries: ZipEntry[];
  try { entries = readZip(bytes); } catch (error) { throw new DocxFormError(error instanceof ZipFormatError ? error.message : "The Word document could not be read."); }
  if (!entries.some((entry) => entry.name === "word/document.xml")) throw new DocxFormError("The file is not a Word document (word/document.xml is missing).");
  if (entries.some((entry) => entry.name === "word/vbaProject.bin")) throw new DocxFormError("Macro-enabled Word documents are not accepted. Save the form as a regular .docx.");
  const xml = new Map<string, string>();
  for (const part of formParts(entries)) {
    const entry = entries.find((item) => item.name === part)!;
    try { xml.set(part, entryText(entry)); } catch (error) { throw new DocxFormError(error instanceof Error ? error.message : "The Word document is damaged."); }
  }
  return { entries, xml };
}

export function analyzeDocx(bytes: Uint8Array): DocxField[] {
  const { xml } = loadParts(bytes);
  return [...xml.entries()].flatMap(([part, content]) => detectPart(content, part).map(({ edit: _edit, position: _position, ...field }) => { void _edit; void _position; return field; }));
}

export function fillDocx(bytes: Uint8Array, fills: readonly DocxFill[]): { bytes: Uint8Array; issues: DocxIssue[] } {
  const { entries, xml } = loadParts(bytes);
  const issues: DocxIssue[] = [];
  const replacements = new Map<string, string>();
  for (const [part, content] of xml) {
    const candidates = detectPart(content, part);
    const edits: Edit[] = [];
    for (const fill of fills.filter((item) => item.target.part === part)) {
      const candidate = candidates.find((item) => item.kind === fill.target.kind && item.ordinal === fill.target.ordinal);
      if (!candidate) { issues.push({ fieldId: fill.fieldId, label: fill.label, kind: "target_missing", message: `"${fill.label ?? fill.target.label}" could not be found in the Word document. Re-analyze the template.` }); continue; }
      if (candidate.label !== fill.target.label) { issues.push({ fieldId: fill.fieldId, label: fill.label, kind: "target_changed", message: `The Word document changed near "${fill.target.label}". Re-analyze the template before generating.` }); continue; }
      if (!fill.value) {
        // A merge token or placeholder prompt must not be printed in an official document; a blank line or empty cell can stay.
        if (candidate.kind === "token" || candidate.kind === "content_control") edits.push(...candidate.edit(""));
        continue;
      }
      edits.push(...candidate.edit(fill.value));
    }
    if (edits.length) replacements.set(part, applyEdits(content, edits));
  }
  for (const fill of fills) if (!xml.has(fill.target.part)) issues.push({ fieldId: fill.fieldId, label: fill.label, kind: "target_missing", message: `"${fill.label ?? fill.target.label}" refers to a part of the Word document that does not exist.` });
  return { bytes: replacements.size ? writeZip(entries, replacements) : bytes, issues };
}

/** Plain text of the body (tables flattened row by row). Used for previews and tests. */
export function docxText(bytes: Uint8Array) {
  const { xml } = loadParts(bytes);
  const body = xml.get("word/document.xml")!;
  return elements(body, "w:p").map((paragraph) => plainText(body, paragraph.inner, paragraph.innerEnd)).join("\n");
}

/**
 * Readable HTML rendition of the completed Word document: paragraphs, tables,
 * bold/italic/underline. It shows the content exactly; page layout (margins,
 * pagination) is decided by Word when the file is opened.
 */
export function docxPreviewHtml(bytes: Uint8Array, highlight: readonly string[] = []) {
  const { xml } = loadParts(bytes);
  const marks = highlight.filter((value) => value.trim().length > 0).sort((a, b) => b.length - a.length);
  const renderPart = (body: string) => {
    const runHtml = (start: number, end: number) => elements(body, "w:r", start, end).map((run) => {
      const content = body.slice(run.inner, run.innerEnd);
      let text = escapeXml(textNodes(body, run.inner, run.innerEnd).map((node) => node.text).join("")).replace(/\n/g, "<br>").replace(/\t/g, "&emsp;");
      if (!text) return "";
      if (/<w:b(?:\s+w:val="(?:1|true)")?\/>/.test(content)) text = `<strong>${text}</strong>`;
      if (/<w:i(?:\s+w:val="(?:1|true)")?\/>/.test(content)) text = `<em>${text}</em>`;
      if (/<w:u w:val="(?!none)/.test(content)) text = `<u>${text}</u>`;
      return text;
    }).join("");
    const paragraphHtml = (paragraph: Block) => {
      let html = runHtml(paragraph.inner, paragraph.innerEnd);
      for (const mark of marks) html = html.split(escapeXml(mark)).join(`<mark>${escapeXml(mark)}</mark>`);
      return `<p>${html || "&nbsp;"}</p>`;
    };
    const parts: string[] = [];
    let cursor = 0;
    const tables = elements(body, "w:tbl");
    const bodyParagraphs = (start: number, end: number) => elements(body, "w:p", start, end).filter((paragraph) => !tables.some((table) => paragraph.start >= table.start && paragraph.end <= table.end)).map(paragraphHtml).join("");
    for (const table of tables) {
      parts.push(bodyParagraphs(cursor, table.start));
      const rows = elements(body, "w:tr", table.inner, table.innerEnd).map((row) => `<tr>${elements(body, "w:tc", row.inner, row.innerEnd).map((cell) => `<td>${elements(body, "w:p", cell.inner, cell.innerEnd).map(paragraphHtml).join("")}</td>`).join("")}</tr>`).join("");
      parts.push(`<table>${rows}</table>`);
      cursor = table.end;
    }
    parts.push(bodyParagraphs(cursor, body.length));
    return parts.join("");
  };
  const headers = [...xml.keys()].filter((name) => name.startsWith("word/header"));
  const footers = [...xml.keys()].filter((name) => name.startsWith("word/footer"));
  // Headers and footers are shown once, above and below the body, with their filled values.
  return [
    ...headers.map((name) => `<header class="docx-header">${renderPart(xml.get(name)!)}</header>`),
    renderPart(xml.get("word/document.xml")!),
    ...footers.map((name) => `<footer class="docx-footer">${renderPart(xml.get(name)!)}</footer>`),
  ].join("");
}
