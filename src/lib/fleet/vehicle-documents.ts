export const VEHICLE_DOCUMENT_TYPES = [
  "Registration",
  "Insurance",
  "Purchase/Title",
  "Maintenance/Repair Invoice",
  "Inspection",
  "Warranty",
  "Other",
] as const;

export type VehicleDocumentType = (typeof VEHICLE_DOCUMENT_TYPES)[number];
export type VehicleDocumentExpirationStatus = "current" | "upcoming" | "expired";

const dateOnly = /^\d{4}-\d{2}-\d{2}$/;

export function isDateOnly(value: string) {
  if (!dateOnly.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function vehicleDocumentMetadata(input: {
  fileName: string;
  title?: unknown;
  documentType?: unknown;
  expirationDate?: unknown;
}) {
  const title = typeof input.title === "string" ? input.title.trim().slice(0, 250) : "";
  const documentType = typeof input.documentType === "string" ? input.documentType.trim() : "Other";
  const expirationDate = typeof input.expirationDate === "string" ? input.expirationDate.trim() : "";
  if (!VEHICLE_DOCUMENT_TYPES.includes(documentType as VehicleDocumentType)) {
    throw new Error("Choose a valid vehicle document type.");
  }
  if (expirationDate && !isDateOnly(expirationDate)) {
    throw new Error("Expiration date must be a valid date.");
  }
  return {
    title: title || input.fileName,
    documentType: documentType as VehicleDocumentType,
    expirationDate: expirationDate || null,
  };
}

export function vehicleDocumentExpirationStatus(expirationDate: string | null | undefined, today = new Date()) {
  if (!expirationDate || !isDateOnly(expirationDate)) return "current" as const;
  const current = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
  const expiration = new Date(`${expirationDate}T00:00:00Z`);
  const days = Math.round((expiration.getTime() - current.getTime()) / 86_400_000);
  if (days < 0) return "expired" as const;
  if (days <= 30) return "upcoming" as const;
  return "current" as const;
}
