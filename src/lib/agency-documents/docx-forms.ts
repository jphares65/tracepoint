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
 * - checkboxes:          checkbox content controls, legacy FORMCHECKBOX fields, Wingdings box symbols and
 *                        ☐ characters (label from the control's title or name, else the words beside the box)
 *
 * Every place gets a locator {part, kind, ordinal, label}. The template file is
 * immutable per version, so the same locator always finds the same spot; the
 * label is re-checked on fill and a mismatch is reported instead of guessed.
 */

export type DocxTargetKind = "token" | "label_blank" | "table_cell" | "content_control" | "legacy_field" | "checkbox";
/**
 * Version of the detection rules that assign kinds and ordinals. Locators saved under another version may
 * point at a different place in the document, so they are refused until the template is set up again.
 * 4: checkboxes are detected (and ☐ characters separate blank labels).
 * 5: boxes after a "Question:" lead-in take the words after them as their label.
 */
export const DOCX_LOCATOR_SCHEME = 5;
export type DocxTarget = { part: string; kind: DocxTargetKind; ordinal: number; label: string; scheme?: number };
export type DocxField = DocxTarget & {
  context: string;
  /** First row of a multi-row list — may not be about a single record. */ repeating?: boolean;
  /** For `repeating` fields: which list (stable per template file) and how many entry rows it has. */ list?: { key: string; rows: number };
  /** Nearest heading above the field (e.g. "SUPERVISOR INFORMATION"), used to spot fields about someone else. */ section?: string;
};
/** A control TracePoint cannot fill (drop-down, combo box, picture). Reported so a person decides; never skipped silently. */
export type DocxUnsupported = { part: string; kind: "dropdown" | "combo_box" | "picture" | "legacy_dropdown"; label: string };
export type DocxFill = { target: DocxTarget; value: string; fieldId?: string; label?: string };
export type DocxIssue = { fieldId?: string; label?: string; kind: "target_missing" | "target_changed" | "invalid_checkbox_value"; message: string };

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

type TextRange = { from: number; to: number; value: string };

/**
 * Replace several non-overlapping character ranges of the concatenated node
 * text at once, keeping each run's formatting. Each value goes into the first
 * node its range touches. Ranges that share a text node (two placeholders in
 * one run) are combined into a single edit of that node.
 */
function replaceTextRanges(nodes: TextNode[], ranges: readonly TextRange[]): Edit[] {
  const sorted = [...ranges].sort((a, b) => a.from - b.from);
  for (let i = 1; i < sorted.length; i += 1) if (sorted[i]!.from < sorted[i - 1]!.to) throw new DocxFormError("Two fields overlap in the Word document.");
  const offsets: number[] = [];
  let total = 0;
  for (const node of nodes) { offsets.push(total); total += node.text.length; }
  // The node that receives each range's value: the first non-empty node it touches.
  const home = sorted.map((range) => nodes.findIndex((node, i) => node.text.length > 0 && offsets[i]! + node.text.length > range.from && offsets[i]! < range.to));
  const edits: Edit[] = [];
  nodes.forEach((node, i) => {
    const nodeStart = offsets[i]!, nodeEnd = nodeStart + node.text.length;
    if (!node.text.length) return;
    const touching = sorted.map((range, r) => ({ range, r })).filter(({ range }) => nodeEnd > range.from && nodeStart < range.to);
    if (!touching.length) return;
    const isText = !(node.text === "\t" || node.text === "\n") || nodes.length === 1;
    if (!isText) {
      const values = touching.filter(({ r }) => home[r] === i).map(({ range }) => range.value).join("");
      edits.push({ start: node.start, end: node.end, replacement: values ? textElements(values) : "" });
      return;
    }
    let out = "", pos = nodeStart;
    for (const { range, r } of touching) {
      const start = Math.max(range.from, nodeStart);
      if (start > pos) out += node.text.slice(pos - nodeStart, start - nodeStart);
      if (home[r] === i) out += range.value;
      pos = Math.max(pos, Math.min(range.to, nodeEnd));
    }
    out += node.text.slice(pos - nodeStart);
    edits.push({ start: node.start, end: node.end, replacement: textElements(out) });
  });
  return edits;
}

/** Replace characters [from, to) of the concatenated node text with value, keeping each run's formatting. */
function replaceTextRange(nodes: TextNode[], from: number, to: number, value: string): Edit[] {
  return replaceTextRanges(nodes, [{ from, to, value }]);
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
  return raw.replace(/[\t\n]+/g, " ").replace(/\s+/g, " ").replace(/^[\s:.\-–—|•☐☑☒□]+|[\s:.\-–—|•☐☑☒□]+$/g, "").replace(/\s*\(\s*\)\s*$/, "").trim();
}

/** Where the words beside a place on the form stop: a tab, a wide gap, a separator, a blank line or another checkbox. */
const LABEL_BREAK = /\t|\s{3,}|;|\||_{3,}|[☐☑☒□]/;
/** Checkbox characters typed into the text. ☐ and □ are empty boxes; ☑ and ☒ are ticked. */
const BOX_GLYPHS = new Set(["☐", "☑", "☒", "□"]);
/** Wingdings box symbols (inserted with Insert > Symbol): empty boxes and ticked boxes. */
const BOX_SYMBOLS = new Set(["F0A8", "F06F", "F071", "F0FE", "F0FD", "F078"]);
/** Yes/no values accepted for a checkbox, the same as for PDF checkboxes. */
const CHECKED = new Set(["x", "yes", "y", "true", "checked", "on", "1", "✓"]);
const UNCHECKED = new Set(["", "no", "n", "false", "off", "0"]);

function checkboxState(value: string) {
  const normalized = value.trim().toLowerCase();
  return CHECKED.has(normalized) ? true : UNCHECKED.has(normalized) ? false : null;
}

function plausibleLabel(label: string) {
  return label.length >= 2 && label.length <= 60 && /[a-z]/i.test(label) && label.split(/\s+/).length <= 8;
}

// ---------------------------------------------------------------- detection

type Candidate = DocxField & {
  edit: (value: string) => Edit[];
  position: number;
  /** For placeholders inside running text: the text nodes and character range, so several placeholders in one run can be filled together. */
  range?: { nodes: TextNode[]; from: number; to: number };
  /**
   * Checkboxes: `anchor` is the control, field or symbol element; `glyph` a ☐ character inside a text node.
   * `preset` is the label the form's author gave the control. `state` turns ticked/unticked into the value passed to edit.
   */
  checkbox?: { anchor?: [number, number]; glyph?: { node: number; offset: number }; preset?: string; state: (checked: boolean) => string };
};

const BLANK = /_{3,}(?:\s*\/\s*_{2,}){0,2}/g;
const TOKEN = /\{\{\s*([^{}]{1,80}?)\s*\}\}|«([^«»]{1,80})»/g;

function paragraphCandidates(xml: string, part: string, paragraph: Block, counters: Record<DocxTargetKind, number>, reserved: (start: number, end: number) => boolean): Candidate[] {
  const out: Candidate[] = [];
  // Text inside a content control or a legacy form field belongs to those detectors. The rest of the
  // paragraph is still scanned, in segments separated by those elements, so a merge token next to a
  // checkbox is not left in the output.
  // A control or field also separates text when it holds no text itself (a checkbox symbol, an empty field).
  const segments: TextNode[][] = [[]];
  let previous = paragraph.inner;
  for (const node of textNodes(xml, paragraph.inner, paragraph.innerEnd)) {
    const inside = reserved(node.start, node.end);
    if ((inside || reserved(previous, node.start)) && segments.at(-1)!.length) segments.push([]);
    previous = node.end;
    if (!inside) segments.at(-1)!.push(node);
  }
  for (const nodes of segments) {
    const text = nodes.map((node) => node.text).join("");
    if (!text.trim()) continue;
    const context = text.trim().slice(0, 120);
    // ☐ typed as text. Labelled later (labelCheckboxes), once every checkbox in the paragraph is known.
    let offset = 0;
    for (const node of nodes) {
      for (let i = 0; i < node.text.length; i += 1) {
        const glyph = node.text[i]!;
        if (!BOX_GLYPHS.has(glyph)) continue;
        const from = offset + i;
        const empty = glyph === "☐" || glyph === "□" ? glyph : "☐";
        out.push({ part, kind: "checkbox", ordinal: counters.checkbox++, label: "", position: node.start, context, range: { nodes, from, to: from + 1 }, checkbox: { glyph: { node: node.start, offset: i }, state: (checked) => (checked ? "☒" : empty) }, edit: (value) => replaceTextRange(nodes, from, from + 1, value) });
      }
      offset += node.text.length;
    }
    const tokenEnds: number[] = [];
    for (const match of text.matchAll(TOKEN)) {
      const from = match.index!, to = from + match[0].length;
      tokenEnds.push(to);
      const label = cleanLabel(match[1] ?? match[2] ?? "");
      if (!label) continue;
      out.push({ part, kind: "token", ordinal: counters.token++, label, position: paragraph.start, context, range: { nodes, from, to }, edit: (value) => replaceTextRange(nodes, from, to, value) });
    }
    let previousEnd = 0;
    for (const match of text.matchAll(BLANK)) {
      const from = match.index!, to = from + match[0].length;
      // The label is the text right before the blank, after any earlier blank, merge token or separator.
      const labelFrom = Math.max(previousEnd, ...tokenEnds.filter((end) => end <= from));
      previousEnd = to;
      const label = cleanLabel(text.slice(labelFrom, from).split(LABEL_BREAK).at(-1) ?? "");
      if (!plausibleLabel(label)) continue;
      out.push({ part, kind: "label_blank", ordinal: counters.label_blank++, label, position: paragraph.start, context, range: { nodes, from, to }, edit: (value) => replaceTextRange(nodes, from, to, value) });
    }
  }
  return out;
}

function firstRunProperties(xml: string, start: number, end: number) {
  const slice = xml.slice(start, end);
  const paragraphMark = slice.match(/<w:pPr>[\s\S]*?(<w:rPr>[\s\S]*?<\/w:rPr>)[\s\S]*?<\/w:pPr>/);
  const run = slice.match(/<w:r(?:\s[^>]*)?>\s*(<w:rPr>[\s\S]*?<\/w:rPr>)/);
  return (paragraphMark?.[1] ?? run?.[1] ?? "").replace(/<w:rStyle w:val="PlaceholderText"\/>/g, "");
}

/** Run properties without emphasis (bold, italic, underline, caps, colour, highlight, shading). */
function withoutEmphasis(rPr: string) {
  const kept = rPr.replace(/<w:(?:b|bCs|i|iCs|u|caps|smallCaps|color|highlight|shd|strike|dstrike)\b[^>]*?\/>/g, "");
  return /^<w:rPr>\s*<\/w:rPr>$/.test(kept) ? "" : kept;
}

/** Edit that writes value into an empty table cell's first paragraph. */
function fillEmptyCell(xml: string, cell: Block, labelCell: Block | null): (value: string) => Edit[] {
  return (value) => {
    const paragraphs = elements(xml, "w:p", cell.inner, cell.innerEnd);
    // An empty cell's own formatting wins. Borrowed from the label cell, only the font and size are kept:
    // a value must not come out bold, underlined or shaded just because its label is.
    const rPr = firstRunProperties(xml, paragraphs[0]?.start ?? cell.inner, paragraphs[0]?.end ?? cell.innerEnd) || (labelCell ? withoutEmphasis(firstRunProperties(xml, labelCell.inner, labelCell.innerEnd)) : "");
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
  // A cell that holds a whole table is layout, not a label or an entry cell; the inner table is scanned on its own.
  const nested = (cell: Block) => elements(xml, "w:tbl", cell.inner, cell.innerEnd).length > 0;
  const unusable = (cell: Block) => continuation(cell) || nested(cell) || NON_TEXT_CONTENT.test(xml.slice(cell.inner, cell.innerEnd)) || reserved(cell.start, cell.end);
  // Treat unusable cells as non-empty text so they are never filled and never pair with a label.
  const texts = rawTexts.map((cells, r) => cells.map((text, c) => (text === "" && unusable(rows[r][c]) ? "\u0000" : text)));
  // Cells with blanks or merge tokens are filled in place; they are not labels for a neighbouring cell.
  const fillsInPlace = (text: string) => /_{3,}|\{\{|«/.test(text);
  rows.forEach((cells, r) => {
    // Horizontal: [Label][empty]
    for (let c = 0; c + 1 < cells.length; c += 1) {
      const label = cleanLabel(texts[r][c]);
      if (unusable(cells[c]) || fillsInPlace(texts[r][c]) || !plausibleLabel(label) || texts[r][c + 1] !== "" || used.has(cells[c + 1].start) || nested(cells[c + 1])) continue;
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
      if (unusable(cell) || fillsInPlace(texts[r][c]) || !plausibleLabel(label)) return;
      if (texts[r + 1][c] !== "" || used.has(below[c].start) || nested(below[c])) return;
      // A label already paired with the empty cell to its right is not also paired downward.
      if (c + 1 < cells.length && texts[r][c + 1] === "" && used.has(cells[c + 1].start)) return;
      used.add(below[c].start);
      out.push({ part, kind: "table_cell", ordinal: counters.table_cell++, label, position: cell.start, repeating: emptyRows > 1, ...(emptyRows > 1 ? { list: { key: `${part}@${table.start}:${r}`, rows: emptyRows } } : {}), context: emptyRows > 1 ? `First row of a ${emptyRows}-row list under "${label}"` : `Table column: ${label}`, edit: fillEmptyCell(xml, below[c], cell) });
    });
  });
  return out;
}

/** Tick or untick a checkbox content control: its w14:checked flag and the box symbol Word shows. */
function checkboxControlEdits(xml: string, prBlock: Block, content: Block, checked: boolean): Edit[] {
  const pr = xml.slice(prBlock.start, prBlock.end);
  const state = pr.match(new RegExp(`<w14:${checked ? "checkedState" : "uncheckedState"}\\b[^>]*>`))?.[0] ?? "";
  const stateChar = state.match(/w14:val="([0-9A-Fa-f]{4})"/)?.[1], stateFont = state.match(/w14:font="([^"]*)"/)?.[1];
  const edits: Edit[] = [];
  const flag = `<w14:checked w14:val="${checked ? 1 : 0}"/>`;
  const existing = /<w14:checked\b[^>]*?\/>/.exec(pr);
  const open = /<w14:checkbox\b[^>]*?(\/?)>/.exec(pr)!;
  if (existing) edits.push({ start: prBlock.start + existing.index, end: prBlock.start + existing.index + existing[0].length, replacement: flag });
  else if (open[1] === "/") edits.push({ start: prBlock.start + open.index, end: prBlock.start + open.index + open[0].length, replacement: `${open[0].slice(0, -2).trimEnd()}>${flag}</w14:checkbox>` });
  else edits.push({ start: prBlock.start + open.index + open[0].length, end: prBlock.start + open.index + open[0].length, replacement: flag });
  const body = xml.slice(content.inner, content.innerEnd);
  const symbol = /<w:sym\b[^>]*\/>/.exec(body);
  if (symbol) {
    const font = stateFont ?? symbol[0].match(/w:font="([^"]*)"/)?.[1] ?? "Wingdings";
    const char = stateChar ?? (checked ? "F0FE" : "F0A8");
    edits.push({ start: content.inner + symbol.index, end: content.inner + symbol.index + symbol[0].length, replacement: `<w:sym w:font="${escapeXml(font)}" w:char="${char}"/>` });
    return edits;
  }
  const nodes = textNodes(xml, content.inner, content.innerEnd);
  const total = nodes.reduce((sum, node) => sum + node.text.length, 0);
  const glyph = String.fromCodePoint(parseInt(stateChar ?? (checked ? "2612" : "2610"), 16));
  if (nodes.length) edits.push(...replaceTextRange(nodes, 0, total, glyph));
  else edits.push({ start: content.inner, end: content.inner, replacement: `<w:r>${textElements(glyph)}</w:r>` });
  return edits;
}

/** Tick or untick a legacy FORMCHECKBOX field by setting its w:checked value. */
function legacyCheckboxEdits(xml: string, begin: number, beginEnd: number, checked: boolean): Edit[] {
  const box = elements(xml, "w:checkBox", begin, beginEnd)[0];
  if (!box) return [];
  const flag = `<w:checked w:val="${checked ? 1 : 0}"/>`;
  if (box.inner === box.innerEnd) return [{ start: box.start, end: box.end, replacement: `<w:checkBox><w:sizeAuto/>${flag}</w:checkBox>` }];
  const inner = xml.slice(box.inner, box.innerEnd).replace(/<w:checked\b[^>]*?\/>/g, "");
  return [{ start: box.inner, end: box.innerEnd, replacement: inner + flag }];
}

/** Wingdings box symbols outside any control or field. */
function symbolCheckboxCandidates(xml: string, part: string, counters: Record<DocxTargetKind, number>, reserved: (start: number, end: number) => boolean): Candidate[] {
  const candidates: Candidate[] = [];
  for (const match of xml.matchAll(/<w:sym\b[^>]*\/>/g)) {
    const start = match.index!, end = start + match[0].length;
    const font = match[0].match(/w:font="([^"]*)"/)?.[1] ?? "", char = (match[0].match(/w:char="([0-9A-Fa-f]{4})"/)?.[1] ?? "").toUpperCase();
    if (!/^wingdings$/i.test(font) || !BOX_SYMBOLS.has(char) || reserved(start, end)) continue;
    candidates.push({ part, kind: "checkbox", ordinal: counters.checkbox++, label: "", position: start, context: "Checkbox", checkbox: { anchor: [start, end], state: (checked) => (checked ? "1" : "0") }, edit: (value) => [{ start, end, replacement: `<w:sym w:font="${escapeXml(font)}" w:char="${value === "1" ? "F0FE" : "F0A8"}"/>` }] });
  }
  return candidates;
}

/**
 * Label every checkbox from the words beside it. In a run of boxes that starts with a box ("☐ Passed ☐ Failed")
 * each label follows its box; otherwise ("Passed ☐ Failed ☐") it comes before. A box with no words beside it in
 * its paragraph takes the cell to its left in a table, or "Checkbox".
 */
function labelCheckboxes(xml: string, candidates: Candidate[], reservedRanges: readonly (readonly [number, number])[]) {
  const boxes = candidates.filter((candidate) => candidate.checkbox);
  if (!boxes.length) return;
  const where = (box: Candidate) => box.checkbox!.anchor?.[0] ?? box.checkbox!.glyph!.node;
  const beside = new Map<Candidate, string>(), question = new Map<Candidate, string>();
  for (const paragraph of elements(xml, "w:p")) {
    const inside = boxes.filter((box) => where(box) >= paragraph.inner && where(box) < paragraph.innerEnd);
    if (!inside.length) continue;
    const anchored = inside.filter((box) => box.checkbox!.anchor);
    type Item = { kind: "box"; box: Candidate } | { kind: "text"; text: string } | { kind: "stop" };
    // Paragraph content in order: text, checkboxes, and other fields or controls (which end a run of boxes).
    const events: Array<{ at: number; item: Item | { kind: "node"; node: TextNode } }> = [
      ...textNodes(xml, paragraph.inner, paragraph.innerEnd).filter((node) => !reservedRanges.some(([a, b]) => node.start < b && node.end > a)).map((node) => ({ at: node.start, item: { kind: "node" as const, node } })),
      ...anchored.map((box) => ({ at: box.checkbox!.anchor![0], item: { kind: "box" as const, box } })),
      ...reservedRanges.filter(([a]) => a >= paragraph.inner && a < paragraph.innerEnd && !anchored.some((box) => box.checkbox!.anchor![0] === a)).map(([a]) => ({ at: a, item: { kind: "stop" as const } })),
    ].sort((a, b) => a.at - b.at);
    const items: Item[] = [];
    for (const { item } of events) {
      if (item.kind !== "node") { items.push(item); continue; }
      let text = "";
      for (let i = 0; i < item.node.text.length; i += 1) {
        const glyphBox = inside.find((box) => box.checkbox!.glyph?.node === item.node.start && box.checkbox!.glyph.offset === i);
        if (glyphBox) { items.push({ kind: "text", text }, { kind: "box", box: glyphBox }); text = ""; } else text += item.node.text[i];
      }
      items.push({ kind: "text", text });
    }
    // Split into runs of boxes; within a run, collect the words before and after each box.
    let run: Array<{ box: Candidate; before: string; after: string }> = [], lead = "";
    const finish = () => {
      if (!run.length) return;
      const opening = run[0]!.before.split(LABEL_BREAK).at(-1) ?? "";
      // "Weapon carried: ☐ Duty ☐ Off-duty" — text ending in a colon asks the question; each box's label follows it.
      const asked = /:\s*$/.test(opening) ? cleanLabel(opening) : "";
      const leading = !opening.trim() || Boolean(asked);
      for (const [index, entry] of run.entries()) {
        const after = cleanLabel(entry.after.split(LABEL_BREAK)[0] ?? ""), before = index === 0 && asked ? "" : cleanLabel(entry.before.split(LABEL_BREAK).at(-1) ?? "");
        const [first, second] = leading ? [after, before] : [before, after];
        beside.set(entry.box, plausibleLabel(first) ? first : plausibleLabel(second) ? second : "");
        if (asked) question.set(entry.box, asked);
      }
      run = []; lead = "";
    };
    for (const item of items) {
      if (item.kind === "stop") { finish(); continue; }
      if (item.kind === "text") { if (run.length) run.at(-1)!.after += item.text; else lead += item.text; continue; }
      run.push({ box: item.box, before: run.length ? run.at(-1)!.after : lead, after: "" });
    }
    finish();
  }
  for (const box of boxes) {
    const preset = box.checkbox!.preset ?? "";
    const label = (plausibleLabel(preset) && !/^(check|checkbox|check box)\s*\d*$/i.test(preset) ? preset : "") || beside.get(box) || cellLabel(xml, where(box)) || "Checkbox";
    box.label = label;
    box.context = question.has(box) ? `Checkbox: ${question.get(box)}: ${label}` : `Checkbox: ${label}`;
  }
}

/** The text of the table cell to the left of a position, for a checkbox alone in its cell. */
function cellLabel(xml: string, at: number) {
  for (const table of allTables(xml).reverse()) {
    if (at < table.start || at >= table.end) continue;
    for (const row of elements(xml, "w:tr", table.inner, table.innerEnd)) {
      const cells = elements(xml, "w:tc", row.inner, row.innerEnd);
      const index = cells.findIndex((cell) => at >= cell.start && at < cell.end);
      if (index > 0) { const label = cleanLabel(plainText(xml, cells[index - 1]!.inner, cells[index - 1]!.innerEnd)); return plausibleLabel(label) ? label : ""; }
      if (index === 0) return "";
    }
  }
  return "";
}

function contentControlCandidates(xml: string, part: string, counters: Record<DocxTargetKind, number>, unsupported: DocxUnsupported[]): { candidates: Candidate[]; ranges: Array<[number, number]> } {
  const candidates: Candidate[] = [], ranges: Array<[number, number]> = [];
  // Containers (building blocks, groups, controls wrapping tables) are not fields themselves; what is inside them is scanned normally.
  const queue: Array<[number, number]> = [[0, xml.length]];
  const found: Array<{ sdt: Block; prBlock: Block; content: Block; pr: string }> = [];
  while (queue.length) {
    const [from, to] = queue.shift()!;
    for (const sdt of elements(xml, "w:sdt", from, to)) {
      const prBlock = elements(xml, "w:sdtPr", sdt.inner, sdt.innerEnd)[0];
      const content = elements(xml, "w:sdtContent", sdt.inner, sdt.innerEnd)[0];
      if (!prBlock || !content) { ranges.push([sdt.start, sdt.end]); continue; }
      const pr = xml.slice(prBlock.start, prBlock.end);
      if (/<w:docPartObj|<w:docPartList|<w:group\b/.test(pr) || elements(xml, "w:tbl", content.inner, content.innerEnd).length) { queue.push([content.inner, content.innerEnd]); continue; }
      ranges.push([sdt.start, sdt.end]);
      found.push({ sdt, prBlock, content, pr });
    }
  }
  found.sort((a, b) => a.sdt.start - b.sdt.start);
  for (const { sdt, prBlock, content, pr } of found) {
    if (/<w14:checkbox/.test(pr)) {
      const name = cleanLabel(decodeXml(pr.match(/<w:alias w:val="([^"]*)"/)?.[1] || pr.match(/<w:tag w:val="([^"]*)"/)?.[1] || ""));
      candidates.push({ part, kind: "checkbox", ordinal: counters.checkbox++, label: "", position: sdt.start, context: "Checkbox", checkbox: { anchor: [sdt.start, sdt.end], preset: name, state: (checked) => (checked ? "1" : "0") }, edit: (value) => checkboxControlEdits(xml, prBlock, content, value === "1") });
      continue;
    }
    const alias = pr.match(/<w:alias w:val="([^"]*)"/)?.[1], tag = pr.match(/<w:tag w:val="([^"]*)"/)?.[1];
    // Lists and pictures are not text fields; their content is left alone, and they are reported for a decision.
    const other = /<w:dropDownList/.test(pr) ? "dropdown" : /<w:comboBox/.test(pr) ? "combo_box" : /<w:picture/.test(pr) ? "picture" : null;
    if (other) { unsupported.push({ part, kind: other, label: cleanLabel(decodeXml(alias || tag || "")) || plainText(xml, content.inner, content.innerEnd).trim().slice(0, 40) || "Unnamed control" }); continue; }
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

function legacyFieldCandidates(xml: string, part: string, counters: Record<DocxTargetKind, number>, unsupported: DocxUnsupported[]): { candidates: Candidate[]; ranges: Array<[number, number]> } {
  const candidates: Candidate[] = [], ranges: Array<[number, number]> = [];
  if (!/FORM(TEXT|CHECKBOX|DROPDOWN)/.test(xml)) return { candidates, ranges };
  const paragraphs = elements(xml, "w:p");
  const paragraphStart = (at: number) => paragraphs.find((paragraph) => at >= paragraph.start && at < paragraph.end)?.inner ?? at;
  // Walk field characters through the whole part, so a field whose result runs into the next paragraph is
  // still one field. Each field is begin … [separate …] end; checkboxes have no separate.
  const token = /<w:fldChar\b[^>]*?w:fldCharType="(begin|separate|end)"[^>]*?(?:\/>|>([\s\S]*?)<\/w:fldChar>)|<w:instrText\b[^>]*>([^<]*)<\/w:instrText>/g;
  type Open = { begin: number; beginEnd: number; ffData: string; instr: string; separateEnd: number | null; depth: number };
  const stack: Open[] = [];
  // The label for a field is the text after the previous field in the same paragraph.
  let previousFieldEnd = 0;
  let match: RegExpExecArray | null;
  while ((match = token.exec(xml))) {
    const at = match.index;
    if (match[3] !== undefined) { if (stack.length) stack[stack.length - 1]!.instr += decodeXml(match[3]); continue; }
    if (match[1] === "begin") stack.push({ begin: at, beginEnd: at + match[0].length, ffData: match[2] ?? "", instr: "", separateEnd: null, depth: stack.length });
    else if (match[1] === "separate") { if (stack.length) stack[stack.length - 1]!.separateEnd = at + match[0].length; }
    else {
      const field = stack.pop();
      if (!field || field.depth !== 0) continue;
      const fieldEnd = at + match[0].length;
      const labelFrom = Math.max(previousFieldEnd, paragraphStart(field.begin));
      previousFieldEnd = fieldEnd;
      if (!/\bFORM(TEXT|CHECKBOX|DROPDOWN)\b/.test(field.instr)) continue;
      // Only the form field itself (code and result) is reserved; text around it is scanned for placeholders.
      ranges.push([field.begin, fieldEnd]);
      const name = cleanLabel(field.ffData.match(/<w:name w:val="([^"]*)"/)?.[1] ?? "");
      if (/\bFORMCHECKBOX\b/.test(field.instr)) {
        // Labelled later (labelCheckboxes) from the words beside the box when its name is generic ("Check1").
        const { begin, beginEnd } = field;
        candidates.push({ part, kind: "checkbox", ordinal: counters.checkbox++, label: "", position: begin, context: "Checkbox", checkbox: { anchor: [begin, fieldEnd], preset: /^(text|check|dropdown)\d*$/i.test(name) ? "" : name, state: (checked) => (checked ? "1" : "0") }, edit: (value) => legacyCheckboxEdits(xml, begin, beginEnd, value === "1") });
        continue;
      }
      if (/\bFORMDROPDOWN\b/.test(field.instr)) { unsupported.push({ part, kind: "legacy_dropdown", label: name && !/^(text|check|dropdown)\d*$/i.test(name) ? name : cleanLabel(plainText(xml, labelFrom, field.begin).split(LABEL_BREAK).at(-1) ?? "") || "Unnamed drop-down" }); continue; }
      if (!/\bFORMTEXT\b/.test(field.instr) || field.separateEnd === null) continue;
      const resultStart = field.separateEnd, resultEnd = at;
      const before = cleanLabel(plainText(xml, labelFrom, field.begin).split(LABEL_BREAK).at(-1) ?? "");
      const label = name && !/^(text|check|dropdown)\d*$/i.test(name) ? name : before;
      if (!plausibleLabel(label)) continue;
      const nodes = textNodes(xml, resultStart, resultEnd);
      const total = nodes.reduce((sum, node) => sum + node.text.length, 0);
      candidates.push({ part, kind: "legacy_field", ordinal: counters.legacy_field++, label, position: field.begin, context: `Form field: ${label}`, edit: (value) => (nodes.length ? replaceTextRange(nodes, 0, total, value) : value ? [{ start: resultStart, end: resultStart, replacement: `<w:r>${textElements(value)}</w:r>` }] : []) });
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
  const tables = allTables(xml);
  for (const paragraph of elements(xml, "w:p")) {
    const text = cleanLabel(plainText(xml, paragraph.inner, paragraph.innerEnd));
    if (!text || text.length > 60 || /_{3,}|\{\{|«|:\s*\S/.test(text)) continue;
    // The innermost table that holds the paragraph decides whether it is a heading row.
    const inTable = tables.filter((table) => paragraph.start > table.start && paragraph.end < table.end).at(-1);
    if (inTable) {
      // Inside a table only a row that is a single (merged) cell counts as a heading.
      const row = elements(xml, "w:tr", inTable.inner, inTable.innerEnd).find((item) => paragraph.start > item.start && paragraph.end < item.end);
      if (!row || elements(xml, "w:tc", row.inner, row.innerEnd).length !== 1) continue;
    }
    found.push({ position: paragraph.start, text });
  }
  return found;
}

/** Every table, including tables nested in cells, outer before inner. */
function allTables(xml: string, start = 0, end = xml.length): Block[] {
  return elements(xml, "w:tbl", start, end).flatMap((table) => [table, ...allTables(xml, table.inner, table.innerEnd)]).sort((a, b) => a.start - b.start);
}

function detectPart(xml: string, part: string, unsupported: DocxUnsupported[] = []): Candidate[] {
  const counters: Record<DocxTargetKind, number> = { token: 0, label_blank: 0, table_cell: 0, content_control: 0, legacy_field: 0, checkbox: 0 };
  const controls = contentControlCandidates(xml, part, counters, unsupported);
  const legacy = legacyFieldCandidates(xml, part, counters, unsupported);
  const reservedRanges: Array<readonly [number, number]> = [...controls.ranges, ...legacy.ranges];
  const reserved = (start: number, end: number) => reservedRanges.some(([a, b]) => start < b && end > a);
  const symbols = symbolCheckboxCandidates(xml, part, counters, reserved);
  // A box symbol separates the text around it, like a checkbox control.
  reservedRanges.push(...symbols.map((symbol) => symbol.checkbox!.anchor!));
  const used = new Set<number>();
  const tables = allTables(xml).flatMap((table) => tableCandidates(xml, part, table, counters, used, reserved));
  const paragraphs = elements(xml, "w:p").flatMap((paragraph) => paragraphCandidates(xml, part, paragraph, counters, reserved));
  const titles = headings(xml);
  const all = [...controls.candidates, ...legacy.candidates, ...symbols, ...tables, ...paragraphs];
  labelCheckboxes(xml, all, reservedRanges);
  return all.map((candidate) => {
    const section = [...titles].reverse().find((title) => title.position < candidate.position && title.text !== candidate.label)?.text;
    return { ...candidate, scheme: DOCX_LOCATOR_SCHEME, ...(section ? { section } : {}) };
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
  return inspectDocx(bytes).fields;
}

/** Fillable places, plus the controls TracePoint cannot fill (which need a person's decision before publishing). */
export function inspectDocx(bytes: Uint8Array): { fields: DocxField[]; unsupported: DocxUnsupported[] } {
  const { xml } = loadParts(bytes);
  const unsupported: DocxUnsupported[] = [];
  const fields = [...xml.entries()].flatMap(([part, content]) => detectPart(content, part, unsupported).map(({ edit: _edit, position: _position, range: _range, checkbox: _checkbox, ...field }) => { void _edit; void _position; void _range; void _checkbox; return field; }));
  return { fields, unsupported };
}

export function fillDocx(bytes: Uint8Array, fills: readonly DocxFill[]): { bytes: Uint8Array; issues: DocxIssue[] } {
  const { entries, xml } = loadParts(bytes);
  const issues: DocxIssue[] = [];
  const replacements = new Map<string, string>();
  for (const [part, content] of xml) {
    const candidates = detectPart(content, part);
    const edits: Edit[] = [];
    // Placeholders in running text are grouped by the text they sit in, so two in one run become one edit.
    const textFills = new Map<TextNode[], TextRange[]>();
    const write = (candidate: Candidate, value: string) => {
      if (!candidate.range) { edits.push(...candidate.edit(value)); return; }
      const list = textFills.get(candidate.range.nodes) ?? [];
      list.push({ from: candidate.range.from, to: candidate.range.to, value });
      textFills.set(candidate.range.nodes, list);
    };
    for (const fill of fills.filter((item) => item.target.part === part)) {
      if (fill.target.scheme !== DOCX_LOCATOR_SCHEME) { issues.push({ fieldId: fill.fieldId, label: fill.label, kind: "target_changed", message: `"${fill.label ?? fill.target.label}" was set up with an earlier version of Word form detection. Set the template up again ("Replace fields") before generating.` }); continue; }
      const candidate = candidates.find((item) => item.kind === fill.target.kind && item.ordinal === fill.target.ordinal);
      if (!candidate) { issues.push({ fieldId: fill.fieldId, label: fill.label, kind: "target_missing", message: `"${fill.label ?? fill.target.label}" could not be found in the Word document. Re-analyze the template.` }); continue; }
      if (candidate.label !== fill.target.label) { issues.push({ fieldId: fill.fieldId, label: fill.label, kind: "target_changed", message: `The Word document changed near "${fill.target.label}". Re-analyze the template before generating.` }); continue; }
      if (candidate.checkbox) {
        // A checkbox is always written, ticked or not, so an unticked box is a decision rather than something skipped.
        const checked = checkboxState(fill.value);
        if (checked === null) { issues.push({ fieldId: fill.fieldId, label: fill.label, kind: "invalid_checkbox_value", message: `"${fill.label ?? fill.target.label}" is a checkbox; "${fill.value}" is not a yes/no value.` }); continue; }
        write(candidate, candidate.checkbox.state(checked));
        continue;
      }
      if (!fill.value) {
        // A merge token or placeholder prompt must not be printed in an official document; a blank line or empty cell can stay.
        if (candidate.kind === "token" || candidate.kind === "content_control") write(candidate, "");
        continue;
      }
      write(candidate, fill.value);
    }
    for (const [nodes, ranges] of textFills) edits.push(...replaceTextRanges(nodes, ranges));
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
  const marks = [...new Set(highlight.filter((value) => value.trim().length > 0))].sort((a, b) => b.length - a.length);
  const markPattern = marks.length ? new RegExp(marks.map((mark) => mark.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "g") : null;
  const plain = (raw: string) => escapeXml(raw).replace(/\n/g, "<br>").replace(/\t/g, "&emsp;");
  // Filled values are highlighted in the text itself, never in the generated markup.
  const markText = (raw: string) => {
    if (!markPattern) return plain(raw);
    let html = "", last = 0;
    for (const match of raw.matchAll(markPattern)) {
      html += plain(raw.slice(last, match.index)) + `<mark>${plain(match[0])}</mark>`;
      last = match.index! + match[0].length;
    }
    return html + plain(raw.slice(last));
  };
  const renderPart = (body: string) => {
    const runHtml = (start: number, end: number) => elements(body, "w:r", start, end).map((run) => {
      const content = body.slice(run.inner, run.innerEnd);
      let text = markText(textNodes(body, run.inner, run.innerEnd).map((node) => node.text).join(""));
      if (!text) return "";
      if (/<w:b(?:\s+w:val="(?:1|true)")?\/>/.test(content)) text = `<strong>${text}</strong>`;
      if (/<w:i(?:\s+w:val="(?:1|true)")?\/>/.test(content)) text = `<em>${text}</em>`;
      if (/<w:u w:val="(?!none)/.test(content)) text = `<u>${text}</u>`;
      return text;
    }).join("");
    const paragraphHtml = (paragraph: Block) => {
      const html = runHtml(paragraph.inner, paragraph.innerEnd);
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
