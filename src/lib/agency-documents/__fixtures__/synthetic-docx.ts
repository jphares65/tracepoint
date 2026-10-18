/** Synthetic Word forms for tests. All content is invented. */
import { createZip } from "../docx-zip";

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

export const p = (...runs: string[]) => `<w:p>${runs.join("")}</w:p>`;
export const r = (text: string, props = "") => `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ""}<w:t xml:space="preserve">${text}</w:t></w:r>`;
export const tab = () => "<w:r><w:tab/></w:r>";
export const cell = (content: string) => `<w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/></w:tcPr>${content || "<w:p/>"}</w:tc>`;
export const row = (...cells: string[]) => `<w:tr>${cells.join("")}</w:tr>`;
export const table = (...rows: string[]) => `<w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/><w:tblBorders><w:top w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/><w:insideH w:val="single" w:sz="4"/><w:insideV w:val="single" w:sz="4"/></w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid>${rows.join("")}</w:tbl>`;
export const contentControl = (alias: string, placeholder: string) => `<w:sdt><w:sdtPr><w:alias w:val="${alias}"/><w:tag w:val="${alias.replace(/\s+/g, "")}"/><w:showingPlcHdr/><w:text/></w:sdtPr><w:sdtContent><w:r><w:rPr><w:rStyle w:val="PlaceholderText"/></w:rPr><w:t>${placeholder}</w:t></w:r></w:sdtContent></w:sdt>`;
export const legacyField = (name: string) => `<w:r><w:fldChar w:fldCharType="begin"><w:ffData><w:name w:val="${name}"/><w:enabled/><w:calcOnExit w:val="0"/><w:textInput/></w:ffData></w:fldChar></w:r><w:r><w:instrText xml:space="preserve"> FORMTEXT </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>     </w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>`;

export function buildDocx(bodyXml: string, options: { header?: string } = {}) {
  const files: Array<[string, string]> = [
    ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>${options.header ? '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' : ""}</Types>`],
    ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`],
    ["word/_rels/document.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${options.header ? '<Relationship Id="rIdH1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>' : ""}</Relationships>`],
    ["word/document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${bodyXml}<w:sectPr>${options.header ? '<w:headerReference w:type="default" r:id="rIdH1"/>' : ""}<w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`],
  ];
  if (options.header) files.push(["word/header1.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr ${NS}>${options.header}</w:hdr>`]);
  return createZip(files);
}

/** A realistic Word qualification form mixing every supported placeholder style, plus traps. */
export function buildQualificationDocx() {
  return buildDocx([
    p(r("ANNUAL FIREARMS QUALIFICATION RECORD", "<w:b/>")),
    p(r("Officer: "), r("{{Officer Name}}", "<w:b/>")),
    p(r("Badge Number: ________"), tab(), r("Rank: ____________")),
    p(r("Date of Report: ____/____/______")),
    table(
      row(cell(p(r("Manufacturer"))), cell(""), cell(p(r("Serial Number")))),
      row(cell(p(r("Model"))), cell(""), cell("")),
    ),
    table(
      row(cell(p(r("Score"))), cell(p(r("Pass/Fail"))), cell(p(r("Instructor Name")))),
      row(cell(""), cell(""), cell("")),
    ),
    p(r("Caliber: "), contentControl("Caliber", "Click or tap here to enter text.")),
    p(r("Case Number: "), legacyField("CaseNo")),
    p(r("Supervisor Name: ______________________")),
    p(r("Officer Signature: ______________________")),
  ].join(""), { header: p(r("{{Agency Name}}")) });
}
