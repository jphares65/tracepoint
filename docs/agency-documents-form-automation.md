# Agency Documents — form automation

How TracePoint turns an agency's existing PDF or Word form into a reusable
template and fills it accurately. Applies to `src/lib/agency-documents/` and
`src/app/(api/)agency-documents/`.

## Principles

1. **Deterministic first.** Fillable PDFs and Word forms are analyzed by rules,
   not by models. The same file always produces the same suggestions.
2. **Never fabricate, never guess silently.** Only an exact, multi-word label
   match with no contradicting wording in any of the field's labels or its
   section heading is pre-confirmed. One-word labels ("Rank", "Score") and
   anything mentioning another person (supervisor, witness, reviewer) need a
   person's confirmation. Learned mappings come only from decisions a person
   made. Anything weaker is flagged and blocks publishing until a
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

## Field identity and gates

- A field keeps its id for as long as it exists. Saving reuses the ids already
  stored for the template version (never ids from elsewhere); setting up again
  from the same form reuses ids by native field name or Word location.
- Published templates cannot be edited, set up, analyzed, or have suggestions
  accepted; unpublish first.
- Publishing and final generation are both refused while any field needs review
  or any repeating section is neither bound nor explicitly left blank.
  "Ignore all" never dismisses a repeating section.
- A place on the form holds one field: accepting a suggestion for an occupied
  location is refused. Editing a suggestion changes only the decision, never
  what was detected (kind, native field, Word location, cells).
- Word locators carry the detection-rule version (`DOCX_LOCATOR_SCHEME`). A
  locator from another version is refused with "set the template up again"
  rather than filled at a possibly different place. Word templates set up
  before scheme 5 must be set up again ("Replace fields").
- Repeating-section bindings cannot be changed on a published template.
- A repeating section that cannot hold every matching record blocks the
  official document under every overflow setting (previews still show what
  fits, flagged). Records are never left out of an issued document.
- Each record of a repeating section takes one whole row of cells and is placed
  on the page of those cells. A cell layout that cannot be split into whole
  records is refused when the binding is saved and again at generation.
- Things TracePoint cannot fill need an explicit "Leave blank" before
  publishing: PDF firearm lists, Word lists with several entry rows (only the
  first row is fillable), Word drop-down, combo-box and picture controls,
  legacy drop-down fields, and PDF image/push-button boxes (other than
  print/reset/submit-style buttons).

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
- Repeating sections can be filled only from qualification history (dates,
  course, result, score, instructor). Firearm lists and Word lists cannot be
  filled from TracePoint data; they are left blank by an explicit decision.
- Word drop-downs, combo boxes, pictures and PDF image fields are never filled.
