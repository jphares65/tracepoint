export const DRILL_DOCUMENT_MAX_BYTES = 15 * 1024 * 1024;

export const DRILL_DOCUMENT_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export function validateDrillDocumentFile(file: Pick<File, "name" | "size" | "type">) {
  if (!file.name.trim() || file.name.length > 255 || /[\\/\u0000-\u001f\u007f]/.test(file.name)) {
    return "The filename is not safe to store.";
  }
  if (file.size <= 0) return "The file is empty.";
  if (file.size > DRILL_DOCUMENT_MAX_BYTES) return "Files may not exceed 15 MB.";
  if (!DRILL_DOCUMENT_MIME_TYPES.has(file.type)) {
    return "Only PDF, JPG, PNG, and WebP files are allowed.";
  }
  return null;
}

export function workspaceHasDrillTemplate(workspace: unknown, drillTemplateId: string) {
  if (!workspace || typeof workspace !== "object") return false;
  const library = (workspace as { drillLibrary?: unknown }).drillLibrary;
  return Array.isArray(library) && library.some((entry) => {
    if (!entry || typeof entry !== "object") return false;
    return (entry as { id?: unknown }).id === drillTemplateId;
  });
}
