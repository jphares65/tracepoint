import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";
import { configuredDocumentVisionAnalyzer, renderPdfPagesForAnalysis } from "../src/lib/agency-documents/document-vision-runtime";
import { GENERAL_VISION_ALLOWED_KEYS, normalizeGeneralFindings } from "../src/lib/agency-documents/visual-template-analyzer";
import { TextractDocumentLayoutProvider } from "../src/lib/agency-documents/document-layout-provider";
import { combineSemanticFindingsWithLayoutDiagnostics, type GeometrySource, type MatchDiagnostic } from "../src/lib/agency-documents/document-layout-matcher";
import { detectRuledGrids } from "../src/lib/agency-documents/ruled-grid-layout-detector";
import { normalizedGeometryToPixels, parseBenchmarkArguments } from "./document-analysis-benchmark-utils";

function escape(value: string) { return value.replace(/[&<>"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[character]!)); }
function annotationSource(source: GeometrySource | undefined, structured: boolean) { return source === "REVIEW" || !source ? "REVIEW" : source === "GRID_DETECTOR" ? "GRID" : structured ? "STRUCTURED" : "TEXTRACT"; }
async function annotate(page: { page: number; imageBytes?: Uint8Array }, proposals: ReturnType<typeof normalizeGeneralFindings>, diagnostics: MatchDiagnostic[]) {
  if (!page.imageBytes) return;
  const image = sharp(page.imageBytes), meta = await image.metadata(), width = meta.width ?? 0, height = meta.height ?? 0;
  if (!width || !height) return;
  const markup = proposals.map(proposal => {
    const diagnostic = diagnostics.find(value => value.page === proposal.page && value.label === proposal.detectedLabel), box = normalizedGeometryToPixels(proposal.geometry, width, height), source = annotationSource(diagnostic?.geometrySource, proposal.kind === "structured_section"), color = source === "TEXTRACT" ? "#0891b2" : source === "STRUCTURED" ? "#d97706" : source === "GRID" ? "#7c3aed" : "#dc2626", label = escape(`${source} · ${proposal.detectedLabel} · ${proposal.suggestedSemanticKey ?? "Manual Entry"} · ${proposal.classification}`);
    return `<rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" fill="none" stroke="${color}" stroke-width="3"${source === "STRUCTURED" ? ' stroke-dasharray="8 5"' : ""}/><rect x="${box.x}" y="${Math.max(0, box.y - 20)}" width="${Math.min(width - box.x, Math.max(120, label.length * 7))}" height="20" fill="${color}"/><text x="${box.x + 3}" y="${Math.max(14, box.y - 6)}" fill="white" font-family="Arial" font-size="12">${label}</text>`;
  }).join("");
  const dir = resolve("tmp/document-analysis-benchmark");
  await mkdir(dir, { recursive: true });
  const output = resolve(dir, `page-${page.page}-annotated.png`);
  await image.composite([{ input: Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${markup}</svg>`), top: 0, left: 0 }]).png().toFile(output);
  console.log(`Annotated output: ${output}`);
}

async function main() {
  const options = parseBenchmarkArguments(process.argv.slice(2));
  if (!options.forceGeneralVision) throw new Error("This benchmark mode requires --force-general-vision.");
  const provider = configuredDocumentVisionAnalyzer();
  if (!provider) throw new Error("Document vision is not configured.");
  if (options.useLayoutProvider && (process.env.TRACEPOINT_DOCUMENT_LAYOUT_PROVIDER ?? "").toLowerCase() !== "textract") throw new Error("Set TRACEPOINT_DOCUMENT_LAYOUT_PROVIDER=textract.");
  const region = process.env.TRACEPOINT_DOCUMENT_TEXTRACT_REGION;
  if (options.useLayoutProvider && !region) throw new Error("TRACEPOINT_DOCUMENT_TEXTRACT_REGION is required.");
  console.log("MODE: FORCED GENERAL VISION — DEVELOPMENT BENCHMARK ONLY");
  if (options.useLayoutProvider) console.log("LAYOUT PROVIDER: TEXTRACT");
  const started = Date.now(), bytes = new Uint8Array(await readFile(options.path)), renderStarted = Date.now(), pages = await renderPdfPagesForAnalysis(bytes, options.lastPage - options.firstPage + 1, options.firstPage), rendererMs = Date.now() - renderStarted, layoutStarted = Date.now(), layout = options.useLayoutProvider ? await new TextractDocumentLayoutProvider(region!).analyze(pages) : undefined, layoutMs = Date.now() - layoutStarted, gridStarted = Date.now(), gridDetections = await Promise.all(pages.filter(page => page.imageBytes).map(page => detectRuledGrids(page.imageBytes!, page.page))), grids = gridDetections.flatMap(result => result.grids), gridMs = Date.now() - gridStarted, providerStarted = Date.now(), raw = await provider.analyze({ pages, allowedSemanticKeys: GENERAL_VISION_ALLOWED_KEYS }), providerMs = Date.now() - providerStarted;
  const matched = layout ? combineSemanticFindingsWithLayoutDiagnostics(raw, layout, grids) : { findings: raw, diagnostics: [] as MatchDiagnostic[] };
  const proposals = normalizeGeneralFindings(matched.findings), accepted = new Set(proposals.map(proposal => `${proposal.page}:${proposal.detectedLabel}`)), unmatched = matched.diagnostics.filter(diagnostic => diagnostic.geometrySource === "REVIEW"), rejected = raw.filter(finding => !accepted.has(`${finding.page}:${finding.label}`)).map(finding => ({ page: finding.page, label: finding.label, reason: "Rejected by existing proposal normalization" }));
  if (options.annotate) for (const page of pages) await annotate(page, proposals.filter(proposal => proposal.page === page.page), matched.diagnostics);
  console.log(JSON.stringify({ mode: "FORCED_GENERAL_VISION", layoutProvider: layout?.provider, pages: pages.map(page => page.page), proposals: proposals.map(proposal => {
    const diagnostic = matched.diagnostics.find(value => value.page === proposal.page && value.label === proposal.detectedLabel);
    return { page: proposal.page, label: proposal.detectedLabel, type: proposal.kind, suggestedSemanticField: proposal.suggestedSemanticKey ?? "Manual Entry", confidence: proposal.classification, geometry: proposal.geometry, geometrySource: diagnostic?.geometrySource ?? "REVIEW" };
  }), matchingDiagnostics: matched.diagnostics, unmatchedSemanticFindings: unmatched.map(diagnostic => ({ page: diagnostic.page, label: diagnostic.label, reasons: diagnostic.matchingReasons })), rejected, textract: { lines: layout?.nodes.filter(node => node.kind === "line").length ?? 0, tables: layout?.nodes.filter(node => node.kind === "table").length ?? 0, cells: layout?.nodes.filter(node => node.kind === "cell").length ?? 0, latencyMs: layoutMs }, gridDetector: { grids: grids.length, horizontalLines: gridDetections.reduce((total, result) => total + result.horizontalLines.length, 0), verticalLines: gridDetections.reduce((total, result) => total + result.verticalLines.length, 0), latencyMs: gridMs }, rendererMs, bedrockLatencyMs: providerMs, totalMs: Date.now() - started }, null, 2));
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Benchmark failed."); process.exitCode = 1; });
