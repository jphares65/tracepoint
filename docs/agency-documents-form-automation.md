# Agency Documents — form automation

How TracePoint turns an agency's existing PDF or Word form into a reusable
template and fills it accurately. Applies to `src/lib/agency-documents/` and
`src/app/(api/)agency-documents/`.

## Principles

1. **Deterministic first.** Fillable PDFs and Word forms are analyzed by rules,
   not by models. The same file always produces the same suggestions.
2. **Never fabricate, never guess silently.** Only an exact label match is
   pre-confirmed. Anything weaker is flagged and blocks publishing until a
   person decides. Missing data is reported, never defaulted.
3. **Preview = document.** Previews, placement proofs, and final documents are
   produced by the same renderer.
4. **Fill the form, don't paint over it.** Native PDF fields and Word
   placeholders are filled in place, so the agency's layout is untouched.

## Flow

```
upload (PDF/.docx, sniffed by content)
  → setup (automatic): analyze → plan → fields
        exact match        → TracePoint data, confirmed
        suggestion         → TracePoint data, "needs review" (blocks publish)
        no match           → entered when generating
        signature/initials → left blank
        repeating table    → structured-binding builder (unchanged)
  → review list: confirm / change flagged fields (no dragging needed)
  → check placement (proof PDF with worst-case sample values + fit report)
  → publish (server refuses while any field needs review)
  → generate: pick officer/firearm/qualification as required
        → review (what will be filled, per-field source)
        → preview (exact output, not saved)
        → final (refused until complete; saved + audited)
```

## Modules

| Module | Responsibility |
| --- | --- |
| `field-matcher.ts` | Label normalization, exact/suggested/unmatched rules, blockers (signature, supervisor, witness, DOB, …), learned mappings. |
| `pdf-form-inspector.ts` | Reads AcroForm fields: names, tooltips, kinds, widgets, flags. Readable errors for damaged/encrypted files. |
| `page-geometry.ts` | The only conversion between PDF space and stored geometry. Honours CropBox and /Rotate (verified against poppler). |
| `template-analyzer.ts` | Proposals from native PDF fields and Word placeholders. |
| `docx-zip.ts`, `docx-forms.ts` | Dependency-free .docx read/write; detection and in-place fill of tokens, label blanks, table cells, content controls, legacy fields. |
| `proposal-review.ts` | Proposal → field row, automatic setup plan, publish gate, bulk-accept rules. |
| `learned-mappings.ts` | Re-uses label decisions the agency confirmed on other templates (only when consistent). |
| `field-values.ts` | Resolves each field from the explicitly selected records; missing/typed/blank status. |
| `generation-context.ts` | Tenant-scoped loading of the selected officer, firearm, qualification, agency, preparer. |
| `pdf-renderer.ts` | Native fill + flatten, overlay drawing, wrapping, fit checks, proof outlines. Never truncates. |
| `document-generation.ts` | Composes resolution + rendering (PDF and Word), template proofs. |
| `generate-handler.ts` | The generate API, dependency-injected for end-to-end tests. |
| `field-review-state.ts` | Builder review-list rules. |

Stored data uses the existing tables (no new migration). Native-field and Word
locators, match status and reasons live in `document_template_fields.formatting`.

## Testing

```
node --import tsx --test src/lib/agency-documents/*.test.ts
```

All fixtures are synthetic (`src/lib/agency-documents/__fixtures__/`). Placement
tests rasterize with poppler (`pdftoppm`) and skip when it is absent; the Word
round-trip test uses LibreOffice when present.

## Known limitations

- Flat/scanned PDFs still rely on the existing visual path (layout profile or the
  optional Bedrock/Textract provider). Their results are always suggestions.
- On-screen builder outlines sit over the browser's PDF viewer and are a guide
  only; the "Check placement" proof is exact. A pdf.js canvas would make the
  on-screen view exact (new dependency — not added).
- The standard PDF font prints Western European characters only; other
  characters are reported, not altered. Embedding a Unicode font needs fontkit.
- Word previews show the completed content; pagination is decided by Word.
  An exact Word→PDF preview would need LibreOffice in the runtime image.
- Encrypted/restricted PDFs and macro-enabled or legacy `.doc` files are refused
  with instructions.
