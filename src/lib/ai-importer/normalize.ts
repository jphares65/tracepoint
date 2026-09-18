export function cleanText(value: unknown, max = 1000) {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, max)
    : value === null || value === undefined
      ? ""
      : String(value).trim().slice(0, max);
}
export function normalizeLabel(value: unknown) {
  return cleanText(value, 250)
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizeIdentifier(value: unknown) {
  return cleanText(value, 250).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function normalizeEmail(value: unknown) {
  return cleanText(value, 320).toLowerCase();
}

export function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export type ParsedDate = {
  value: string | null;
  warning?: string;
  error?: string;
};

function isoDate(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function parseImportDate(value: unknown): ParsedDate {
  const text = cleanText(value, 100);
  if (!text) return { value: null };

  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(text)) {
    const [year, month, day] = text.split("-").map(Number);
    const valueDate = isoDate(year, month, day);
    return valueDate ? { value: valueDate } : { value: null, error: `"${text}" is not a valid date.` };
  }

  if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(text)) {
    const [year, month, day] = text.split("/").map(Number);
    const valueDate = isoDate(year, month, day);
    return valueDate ? { value: valueDate } : { value: null, error: `"${text}" is not a valid date.` };
  }

  const us = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2}|\d{4})$/);
  if (us) {
    const month = Number(us[1]);
    const day = Number(us[2]);
    const rawYear = Number(us[3]);
    const year = rawYear < 100 ? (rawYear >= 70 ? 1900 + rawYear : 2000 + rawYear) : rawYear;
    const valueDate = isoDate(year, month, day);
    if (!valueDate) return { value: null, error: `"${text}" is not a valid date.` };
    return month <= 12 && day <= 12
      ? { value: valueDate, warning: `Ambiguous date "${text}" was interpreted as month/day/year.` }
      : { value: valueDate };
  }

  if (/^\d+(\.\d+)?$/.test(text)) {
    const serial = Number(text);
    if (serial >= 1 && serial <= 2958465) {
      const epoch = Date.UTC(1899, 11, 30);
      const date = new Date(epoch + Math.floor(serial) * 86400000);
      return { value: date.toISOString().slice(0, 10) };
    }
  }

  const named = new Date(text);
  if (!Number.isNaN(named.valueOf()) && /[A-Za-z]/.test(text)) {
    return { value: named.toISOString().slice(0, 10) };
  }

  return { value: null, error: `"${text}" is not a supported date. Use YYYY-MM-DD or MM/DD/YYYY.` };
}

export function parseInteger(value: unknown) {
  const text = cleanText(value, 100).replaceAll(",", "");
  if (!text) return { value: null as number | null };
  const parsed = Number(text);
  return Number.isInteger(parsed)
    ? { value: parsed }
    : { value: null as number | null, error: `"${text}" must be a whole number.` };
}

export function parseDecimal(value: unknown) {
  const text = cleanText(value, 100).replaceAll(",", "");
  if (!text) return { value: null as number | null };
  const parsed = Number(text);
  return Number.isFinite(parsed)
    ? { value: parsed }
    : { value: null as number | null, error: `"${text}" must be a number.` };
}

export function parseBoolean(value: unknown, defaultValue = true) {
  const text = normalizeLabel(value);
  if (!text) return defaultValue;
  if (["true", "yes", "y", "1", "active", "current", "employed"].includes(text)) return true;
  if (["false", "no", "n", "0", "inactive", "retired", "terminated", "separated"].includes(text)) return false;
  return null;
}
