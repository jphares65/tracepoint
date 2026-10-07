import type { FieldGeometry } from "./template-core";
import type { GeneralVisionFinding } from "./visual-template-analyzer";
import { enclosingTable, matchLayoutLabel, protectedSemantic, type DocumentLayout, type LayoutCandidate, type LayoutNode, valueCandidatesForLabel } from "./document-layout-provider";

const review = { x: .01, y: .01, width: .02, height: .02 };
export type GeometrySource = "TEXTRACT_VALUE" | "TEXTRACT_CELL" | "TEXTRACT_TABLE_SUBSECTION" | "TEXTRACT_DERIVED_REGION" | "REVIEW";
export type MatchDiagnostic = { label: string; page: number; chosenTextractCandidate?: string; candidateType?: string; matchScore?: number; matchingReasons: string[]; rejectedCandidateCount: number; geometrySource: GeometrySource };
export type CombinedLayoutResult = { findings: GeneralVisionFinding[]; diagnostics: MatchDiagnostic[] };

function union(nodes: LayoutNode[]): FieldGeometry | undefined {
  if (!nodes.length) return undefined;
  const left = Math.min(...nodes.map(node => node.geometry.x)), top = Math.min(...nodes.map(node => node.geometry.y));
  const right = Math.max(...nodes.map(node => node.geometry.x + node.geometry.width)), bottom = Math.max(...nodes.map(node => node.geometry.y + node.geometry.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}
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

function reviewFinding(finding: GeneralVisionFinding, semanticKey: string | undefined, reasons: string[], rejectedCandidateCount: number): { finding: GeneralVisionFinding; diagnostic: MatchDiagnostic } {
  return { finding: { ...finding, semanticKey, geometry: review, rationale: `REVIEW GEOMETRY: ${reasons.join("; ")}` }, diagnostic: { label: finding.label, page: finding.page, matchingReasons: reasons, rejectedCandidateCount, geometrySource: "REVIEW" } };
}

export function combineSemanticFindingsWithLayoutDiagnostics(findings: GeneralVisionFinding[], layout: DocumentLayout): CombinedLayoutResult {
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
        const result = reviewFinding(finding, semanticKey, [...label.reasons, "no bounded writable cell subsection"], 0);
        diagnostics.push(result.diagnostic);
        return result.finding;
      }
      cells.forEach(cell => owned.add(cell.id));
      const source: GeometrySource = "TEXTRACT_TABLE_SUBSECTION";
      diagnostics.push({ label: finding.label, page: finding.page, chosenTextractCandidate: cells.map(cell => cell.id).join(","), candidateType: "cell subsection", matchScore: label.score, matchingReasons: [...label.reasons, "bounded following table cells"], rejectedCandidateCount: 0, geometrySource: source });
      return { ...finding, semanticKey, geometry, rationale: `${source}: bounded Textract cells` };
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
