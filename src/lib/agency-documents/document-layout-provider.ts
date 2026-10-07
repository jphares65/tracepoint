import { AnalyzeDocumentCommand, TextractClient, type Block } from "@aws-sdk/client-textract";
import type { FieldGeometry } from "./template-core";

export type LayoutKind = "line" | "word" | "table" | "cell" | "key" | "value" | "selection";
export type LayoutNode = { id: string; page: number; kind: LayoutKind; text: string; geometry: FieldGeometry; confidence: number; row?: number; column?: number; links: string[] };
export type DocumentLayout = { provider: "textract"; version: string; nodes: LayoutNode[] };
export type LayoutCandidate = { node: LayoutNode; score: number; reasons: string[] };

function geometry(block: Block): FieldGeometry | null {
  const box = block.Geometry?.BoundingBox;
  if (!box || box.Left === undefined || box.Top === undefined || box.Width === undefined || box.Height === undefined || box.Width <= 0 || box.Height <= 0) return null;
  return { x: box.Left, y: box.Top, width: box.Width, height: box.Height };
}

export function normalizeTextractBlocks(blocks: Block[]): LayoutNode[] {
  return blocks.flatMap(block => {
    const bounds = geometry(block), id = block.Id;
    if (!bounds || !id) return [];
    const kind: LayoutKind | undefined = block.BlockType === "LINE" ? "line" : block.BlockType === "WORD" ? "word" : block.BlockType === "TABLE" ? "table" : block.BlockType === "CELL" ? "cell" : block.BlockType === "SELECTION_ELEMENT" ? "selection" : block.BlockType === "KEY_VALUE_SET" ? (block.EntityTypes?.includes("KEY") ? "key" : "value") : undefined;
    if (!kind) return [];
    return [{ id, page: block.Page ?? 1, kind, text: block.Text ?? "", geometry: bounds, confidence: (block.Confidence ?? 0) / 100, row: block.RowIndex, column: block.ColumnIndex, links: (block.Relationships ?? []).flatMap(relationship => relationship.Ids ?? []) }];
  });
}

export interface DocumentLayoutProvider { analyze(pages: { page: number; imageBytes?: Uint8Array }[]): Promise<DocumentLayout> }
export class TextractDocumentLayoutProvider implements DocumentLayoutProvider {
  constructor(private readonly region: string, private readonly client = new TextractClient({ region, maxAttempts: 5, retryMode: "adaptive" })) {}
  async analyze(pages: { page: number; imageBytes?: Uint8Array }[]): Promise<DocumentLayout> {
    const nodes: LayoutNode[] = [];
    for (const page of pages) {
      if (!page.imageBytes) continue;
      const response = await this.client.send(new AnalyzeDocumentCommand({ Document: { Bytes: page.imageBytes }, FeatureTypes: ["FORMS", "TABLES"] }));
      nodes.push(...normalizeTextractBlocks(response.Blocks ?? []).map(node => ({ ...node, page: page.page })));
    }
    return { provider: "textract", version: "AnalyzeDocument/FORMS+TABLES", nodes };
  }
}

function words(value: string) { return value.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean); }
function verticalOverlap(a: FieldGeometry, b: FieldGeometry) { return Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)) / Math.min(a.height, b.height); }
function verticalCenterDistance(a: FieldGeometry, b: FieldGeometry) { return Math.abs(a.y + a.height / 2 - (b.y + b.height / 2)); }
function contains(outer: FieldGeometry, inner: FieldGeometry) { return inner.x >= outer.x - .002 && inner.y >= outer.y - .002 && inner.x + inner.width <= outer.x + outer.width + .002 && inner.y + inner.height <= outer.y + outer.height + .002; }

export function labelSimilarity(left: string, right: string) {
  const a = new Set(words(left)), b = new Set(words(right));
  return a.size && b.size ? [...a].filter(word => b.has(word)).length / Math.max(a.size, b.size) : 0;
}

function sectionFromLabel(label: string) { return label.match(/section\s+([abc])\b/i)?.[1]?.toLowerCase(); }
function nearbySectionBonus(node: LayoutNode, section: string | undefined, layout: DocumentLayout) {
  if (!section) return 0;
  const marker = new RegExp(`^${section}[. )]|section\\s+${section}\\b`, "i");
  return layout.nodes.some(candidate => candidate.page === node.page && candidate.kind === "line" && candidate.geometry.y <= node.geometry.y && node.geometry.y - candidate.geometry.y < .28 && marker.test(candidate.text.trim())) ? .3 : 0;
}

export function matchLayoutLabel(label: string, page: number, layout: DocumentLayout): LayoutCandidate | undefined {
  const section = sectionFromLabel(label);
  return layout.nodes.filter(node => node.page === page && ["line", "key", "cell"].includes(node.kind) && node.text).map(node => {
    const similarity = labelSimilarity(label, node.text);
    const sectionBonus = nearbySectionBonus(node, section, layout);
    return { node, score: similarity + sectionBonus, reasons: [similarity >= .99 ? "exact label text" : similarity > .4 ? "near label text" : "weak label text", ...(sectionBonus ? [`section ${section!.toUpperCase()} context`] : [])] };
  }).filter(candidate => candidate.score >= .35).sort((a, b) => b.score - a.score || a.node.geometry.y - b.node.geometry.y)[0];
}

export function valueCandidatesForLabel(label: LayoutNode, layout: DocumentLayout, labelScore = 1): LayoutCandidate[] {
  const linked = new Set(label.links);
  return layout.nodes.filter(node => node.page === label.page && (node.kind === "value" || node.kind === "cell") && node.geometry.x >= label.geometry.x + label.geometry.width - .01).map(node => {
    const overlap = verticalOverlap(label.geometry, node.geometry), centerDistance = verticalCenterDistance(label.geometry, node.geometry), horizontalDistance = Math.max(0, node.geometry.x - (label.geometry.x + label.geometry.width));
    const linkedValue = linked.has(node.id);
    const oversized = node.geometry.height > Math.max(label.geometry.height * 2.25, .055);
    const tooSmall = node.geometry.width < .02 || node.geometry.height < .006;
    const score = labelScore * .55 + (linkedValue ? .75 : 0) + overlap * .65 + Math.max(0, .28 - horizontalDistance) - centerDistance * 3.5 - (oversized ? .9 : 0) - node.geometry.width * .08;
    const reasons = [linkedValue ? "KEY_VALUE_SET relationship" : "right-side candidate", overlap > .6 ? "same row overlap" : "limited row overlap", horizontalDistance < .08 ? "adjacent horizontally" : "distant horizontally", ...(oversized ? ["penalty: spans multiple rows"] : []), ...(tooSmall ? ["rejected: implausibly small writable region"] : [])];
    return { node, score, reasons };
  }).filter(candidate => candidate.node.geometry.width >= .02 && candidate.node.geometry.height >= .006 && candidate.score >= .35).sort((a, b) => b.score - a.score || a.node.geometry.width * a.node.geometry.height - b.node.geometry.width * b.node.geometry.height);
}

export function valueRegionForLabel(label: LayoutNode, layout: DocumentLayout) { return valueCandidatesForLabel(label, layout)[0]?.node; }
export function enclosingTable(node: LayoutNode, layout: DocumentLayout) { return layout.nodes.filter(candidate => candidate.page === node.page && candidate.kind === "table" && contains(candidate.geometry, node.geometry)).sort((a, b) => a.geometry.width * a.geometry.height - b.geometry.width * b.geometry.height)[0]; }
export function protectedSemantic(label: string, key: string | undefined) {
  if (/annual firearms report|report year|^year$/i.test(label) || /date of report|report date/i.test(label)) return key === "qualification.date" ? undefined : key;
  if (/chief of police|sheriff|director/i.test(label) && key === "person.full_name") return undefined;
  if (/instructor\(s\)/i.test(label) && key === "qualification.instructor") return undefined;
  return key;
}
