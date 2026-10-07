import type { FieldGeometry } from "./template-core";
import type { GeneralVisionFinding } from "./visual-template-analyzer";
import { enclosingTable, matchLayoutLabel, protectedSemantic, type DocumentLayout, type LayoutCandidate, type LayoutNode, valueCandidatesForLabel } from "./document-layout-provider";
import type { RuledGrid } from "./ruled-grid-layout-detector";
import type { StructuredTargetCell } from "./template-analyzer";

const review = { x: .01, y: .01, width: .02, height: .02 };
export type GeometrySource = "TEXTRACT_VALUE" | "TEXTRACT_CELL" | "TEXTRACT_TABLE" | "GRID_DETECTOR" | "REVIEW";
export type MatchDiagnostic = { label: string; page: number; chosenTextractCandidate?: string; candidateType?: string; matchScore?: number; matchingReasons: string[]; rejectedCandidateCount: number; geometrySource: GeometrySource; matchedSection?: string; gridBounds?: FieldGeometry; lineCount?: number; inferredRowCount?: number; inferredColumnCount?: number; confidence?: number };
export type CombinedLayoutResult = { findings: GeneralVisionFinding[]; diagnostics: MatchDiagnostic[] };

function union(nodes: LayoutNode[]): FieldGeometry | undefined {
  if (!nodes.length) return undefined;
  const left = Math.min(...nodes.map(node => node.geometry.x)), top = Math.min(...nodes.map(node => node.geometry.y));
  const right = Math.max(...nodes.map(node => node.geometry.x + node.geometry.width)), bottom = Math.max(...nodes.map(node => node.geometry.y + node.geometry.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}
function orderedCells(cells: Array<{ page: number; geometry: FieldGeometry; row?: number; column?: number }>, source: "textract" | "grid_detector"): StructuredTargetCell[] { const sorted = [...cells].sort((a, b) => (a.row ?? 0) - (b.row ?? 0) || (a.column ?? 0) - (b.column ?? 0) || a.geometry.y - b.geometry.y || a.geometry.x - b.geometry.x); const positions = new Map<number, number>(); return sorted.map((cell, index) => { const row = cell.row ?? index + 1, column = cell.column ?? (positions.get(row) ?? 0) + 1; positions.set(row, column); return { page: cell.page, order: index + 1, row, column, geometry: cell.geometry, source }; }); }
function gridCells(grid: RuledGrid): StructuredTargetCell[] { const cells: Array<{ page: number; geometry: FieldGeometry; row: number; column: number }> = []; for (let row = 0; row < grid.rows; row++) for (let column = 0; column < grid.columns; column++) cells.push({ page: grid.page, row: row + 1, column: column + 1, geometry: { x: grid.geometry.x + grid.geometry.width * column / grid.columns, y: grid.geometry.y + grid.geometry.height * row / grid.rows, width: grid.geometry.width / grid.columns, height: grid.geometry.height / grid.rows } }); return orderedCells(cells, "grid_detector"); }
function sectionMarker(text: string) { return text.trim().match(/^([abc])[. )]/i)?.[1]?.toLowerCase(); }
function datesFiredAnchorCandidates(page: number, layout: DocumentLayout) { return layout.nodes.filter(node => node.page === page && node.kind === "line" && /dates\s+fired/i.test(node.text)).sort((a, b) => a.geometry.y - b.geometry.y); }

function subsectionCells(finding: GeneralVisionFinding, label: LayoutCandidate, layout: DocumentLayout): LayoutNode[] {
  const anchor = label.node, table = enclosingTable(anchor, layout);
  const dateAnchors = datesFiredAnchorCandidates(finding.page, layout);
  const nextDateAnchor = dateAnchors.find(node => node.id !== anchor.id && node.geometry.y > anchor.geometry.y + .01);
  const nextSection = layout.nodes.filter(node => node.page === finding.page && node.kind === "line" && node.geometry.y > anchor.geometry.y + .01 && sectionMarker(node.text)).sort((a, b) => a.geometry.y - b.geometry.y)[0];
  const bottom = Math.min(nextDateAnchor?.geometry.y ?? 1, nextSection?.geometry.y ?? 1, table ? table.geometry.y + table.geometry.height : 1);
  return layout.nodes.filter(node => node.page === finding.page && node.kind === "cell" && node.geometry.y >= anchor.geometry.y - .008 && node.geometry.y + node.geometry.height <= bottom + .004 && (!table || node.geometry.x >= table.geometry.x - .004 && node.geometry.x + node.geometry.width <= table.geometry.x + table.geometry.width + .004));
}
function nearestGrid(finding: GeneralVisionFinding, label: LayoutCandidate, layout: DocumentLayout, grids: RuledGrid[], owned: Set<string>) {
  const anchor = label.node, nextSection = layout.nodes.filter(node => node.page === finding.page && node.kind === "line" && node.geometry.y > anchor.geometry.y + .01 && sectionMarker(node.text)).sort((a, b) => a.geometry.y - b.geometry.y)[0];
  const boundary = nextSection?.geometry.y ?? 1, section = finding.label.match(/section\s+([abc])/i)?.[1]?.toUpperCase();
  return grids.filter(grid => grid.page === finding.page && !owned.has(grid.id) && grid.geometry.y >= anchor.geometry.y + anchor.geometry.height - .01 && grid.geometry.y < boundary && grid.geometry.x <= anchor.geometry.x + anchor.geometry.width + .1).map(grid => ({ grid, score: grid.confidence - (grid.geometry.y - anchor.geometry.y) * .8, section })).sort((a, b) => b.score - a.score)[0];
}

function reviewFinding(finding: GeneralVisionFinding, semanticKey: string | undefined, reasons: string[], rejectedCandidateCount: number): { finding: GeneralVisionFinding; diagnostic: MatchDiagnostic } {
  return { finding: { ...finding, semanticKey, geometry: review, rationale: `REVIEW GEOMETRY: ${reasons.join("; ")}` }, diagnostic: { label: finding.label, page: finding.page, matchingReasons: reasons, rejectedCandidateCount, geometrySource: "REVIEW" } };
}

export function combineSemanticFindingsWithLayoutDiagnostics(findings: GeneralVisionFinding[], layout: DocumentLayout, grids: RuledGrid[] = []): CombinedLayoutResult {
  const owned = new Set<string>();
  const diagnostics: MatchDiagnostic[] = [];
  const matched = findings.map(finding => {
    const semanticKey = protectedSemantic(finding.label, finding.semanticKey);
    const label = matchLayoutLabel(finding.label, finding.page, layout);
    if (!label) {
      const result = reviewFinding(finding, semanticKey, ["no reliable Textract label candidate"], 0);
      diagnostics.push(result.diagnostic);
      return result.finding;
    }
    if (finding.kind === "structured") {
      const cells = subsectionCells(finding, label, layout).filter(cell => !owned.has(cell.id));
      const geometry = union(cells);
      if (!geometry) {
        const grid = nearestGrid(finding, label, layout, grids, owned);
        if (grid) {
          owned.add(grid.grid.id);
          diagnostics.push({ label: finding.label, page: finding.page, chosenTextractCandidate: grid.grid.id, candidateType: "ruled grid", matchScore: grid.score, matchingReasons: [...label.reasons, "nearest following ruled grid"], rejectedCandidateCount: grids.filter(candidate => candidate.page === finding.page).length - 1, geometrySource: "GRID_DETECTOR", matchedSection: grid.section, gridBounds: grid.grid.geometry, lineCount: grid.grid.horizontalLines + grid.grid.verticalLines, inferredRowCount: grid.grid.rows, inferredColumnCount: grid.grid.columns, confidence: grid.grid.confidence });
          return { ...finding, semanticKey, geometry: grid.grid.geometry, rationale: "GRID_DETECTOR: bounded ruled grid", targetCells: gridCells(grid.grid) };
        }
        const result = reviewFinding(finding, semanticKey, [...label.reasons, "no bounded writable cell subsection or ruled grid"], grids.filter(candidate => candidate.page === finding.page).length);
        diagnostics.push(result.diagnostic);
        return result.finding;
      }
      cells.forEach(cell => owned.add(cell.id));
      const source: GeometrySource = "TEXTRACT_TABLE";
      diagnostics.push({ label: finding.label, page: finding.page, chosenTextractCandidate: cells.map(cell => cell.id).join(","), candidateType: "cell subsection", matchScore: label.score, matchingReasons: [...label.reasons, "bounded following table cells"], rejectedCandidateCount: 0, geometrySource: source });
      return { ...finding, semanticKey, geometry, rationale: `${source}: bounded Textract cells`, targetCells: orderedCells(cells, "textract") };
    }
    const candidates = valueCandidatesForLabel(label.node, layout, label.score);
    const selected = candidates.find(candidate => !owned.has(candidate.node.id));
    if (!selected) {
      const rejected = candidates.length;
      const result = reviewFinding(finding, semanticKey, [...label.reasons, rejected ? "all plausible value regions already owned" : "no plausible adjacent value region"], rejected);
      diagnostics.push(result.diagnostic);
      return result.finding;
    }
    owned.add(selected.node.id);
    const source: GeometrySource = selected.node.kind === "value" ? "TEXTRACT_VALUE" : "TEXTRACT_CELL";
    diagnostics.push({ label: finding.label, page: finding.page, chosenTextractCandidate: selected.node.id, candidateType: selected.node.kind, matchScore: selected.score, matchingReasons: [...label.reasons, ...selected.reasons], rejectedCandidateCount: candidates.length - 1, geometrySource: source });
    return { ...finding, semanticKey, geometry: selected.node.geometry, rationale: `${source}: scored Textract writable region` };
  });
  return { findings: matched, diagnostics };
}

export function combineSemanticFindingsWithLayout(findings: GeneralVisionFinding[], layout: DocumentLayout) { return combineSemanticFindingsWithLayoutDiagnostics(findings, layout).findings; }
