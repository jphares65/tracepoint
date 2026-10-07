import { combineSemanticFindingsWithLayoutDiagnostics } from "./document-layout-matcher";
import type { DocumentLayoutProvider } from "./document-layout-provider";
import { detectRuledGrids } from "./ruled-grid-layout-detector";
import { GENERAL_VISION_ALLOWED_KEYS, normalizeGeneralFindings, type GeneralVisionTemplateAnalyzer, type VisualPage } from "./visual-template-analyzer";

export async function analyzeScannedPagesWithLayout(pages: VisualPage[], vision: GeneralVisionTemplateAnalyzer, layoutProvider?: DocumentLayoutProvider) {
  const findings = await vision.analyze({ pages, allowedSemanticKeys: GENERAL_VISION_ALLOWED_KEYS });
  if (!layoutProvider) return normalizeGeneralFindings(findings);
  try {
    const [layout, detections] = await Promise.all([layoutProvider.analyze(pages), Promise.all(pages.filter(page => page.imageBytes).map(page => detectRuledGrids(page.imageBytes!, page.page)))]);
    return normalizeGeneralFindings(combineSemanticFindingsWithLayoutDiagnostics(findings, layout, detections.flatMap(detection => detection.grids)).findings);
  } catch { return normalizeGeneralFindings(findings); }
}
