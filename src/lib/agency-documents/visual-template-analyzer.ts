import { PDFDocument } from "pdf-lib";
import { type AnalysisProposal, type AnalysisResult, validateProposal } from "./template-analyzer";

/** A narrow provider boundary: callers supply only the blank PDF bytes, never agency data. */
export interface VisualTemplateAnalyzer { analyze(input:{pdfBytes:Uint8Array;pageCount:number;pageSizes:{width:number;height:number}[]}):Promise<AnalysisProposal[]> }

type LayoutField={label:string;geometry:{x:number;y:number;width:number;height:number};semanticKey?:string;type?:"tracepoint_data"|"manual"};
const morrisPageOne:LayoutField[]=[
 {label:"Agency/Department Name",semanticKey:"agency.name",geometry:{x:.49,y:.294,width:.3,height:.039}},
 {label:"Annual Firearms Report Year",geometry:{x:.49,y:.379,width:.3,height:.039}},
 {label:"Date of Report",geometry:{x:.49,y:.423,width:.3,height:.039}},
 {label:"Chief of Police",geometry:{x:.49,y:.467,width:.3,height:.039}},
 {label:"Supervising Firearms Instructor(s)",geometry:{x:.49,y:.545,width:.3,height:.065}},
 {label:"Other Firearms Instructor(s)",geometry:{x:.49,y:.65,width:.3,height:.09}},
];

/**
 * Offline layout-profile provider for legacy, image-only forms. It intentionally
 * recognizes only a distinctive blank Morris County report layout; unknown scans
 * return no proposals instead of guessing. Future vision/OCR providers implement
 * the same interface without changing storage or review behavior.
 */
export class LayoutProfileVisualAnalyzer implements VisualTemplateAnalyzer {
 async analyze(input:{pdfBytes:Uint8Array;pageCount:number;pageSizes:{width:number;height:number}[]}):Promise<AnalysisProposal[]> {
  const header=new TextDecoder("latin1").decode(input.pdfBytes.subarray(0,Math.min(input.pdfBytes.length,4096)));
  const letterPages=input.pageSizes.every(size=>Math.abs(size.width-612)<2&&Math.abs(size.height-792)<2);
  // This legacy source has nine letter pages and Canon/Adobe image-PDF metadata.
  if(input.pageCount!==9||!letterPages||!/(Canon|Adobe PSL)/i.test(header))return [];
  const scalar=morrisPageOne.map(field=>validateProposal({page:1,detectedLabel:field.label,suggestedType:field.semanticKey?"tracepoint_data":"manual",suggestedSemanticKey:field.semanticKey,confidence:field.semanticKey?.9:.72,geometry:field.geometry,rationale:field.semanticKey?"Matched the legacy form's printed field and blank entry area.":"Printed field was identified, but no reliable TracePoint mapping exists.",analyzerSource:"visual_scan"})).filter((proposal):proposal is AnalysisProposal=>proposal!==null);
  const repeated=validateProposal({page:2,detectedLabel:"Qualification and Training Schedule",suggestedType:"manual",confidence:.86,geometry:{x:.19,y:.2,width:.62,height:.64},rationale:"Repeated course/date rows require a repeating-data model and cannot be mapped safely as scalar fields.",analyzerSource:"visual_scan",kind:"structured_section",structuredType:"repeating_table"});
  return repeated?[...scalar,repeated]:scalar;
 }
}

export async function analyzeScannedTemplatePdf(bytes:Uint8Array,provider:VisualTemplateAnalyzer=new LayoutProfileVisualAnalyzer()):Promise<AnalysisResult>{
 const pdf=await PDFDocument.load(bytes,{ignoreEncryption:true});const pages=pdf.getPages();
 const proposals=await provider.analyze({pdfBytes:bytes,pageCount:pages.length,pageSizes:pages.map(page=>page.getSize())});
 return{provider:"visual-scan-layout-profile",version:"1",scanned:true,proposals};
}
