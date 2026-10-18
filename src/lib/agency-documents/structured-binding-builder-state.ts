import type { StructuredBindingTargetCellRow } from "./structured-binding-repository";

export type BindingStatus = "Not bound" | "Bound to Qualification History" | "Review required";
export function structuredSectionKey(proposalId: string) { return `structured-section-${proposalId}`; }
export function orderedTargetCells(cells: StructuredBindingTargetCellRow[]) { return [...cells].sort((a, b) => a.row - b.row || a.column - b.column || a.geometry.y - b.geometry.y || a.geometry.x - b.geometry.x).map((cell, index) => ({ ...cell, order: index + 1 })); }
export function bindingStatus(binding: { sourceType: string; targetCells: StructuredBindingTargetCellRow[] } | undefined, cells: StructuredBindingTargetCellRow[]): BindingStatus { if (!binding) return cells.length ? "Not bound" : "Review required"; return binding.sourceType === "qualification_history" && binding.targetCells.length ? "Bound to Qualification History" : "Review required"; }
