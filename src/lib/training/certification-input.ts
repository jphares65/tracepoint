// Server-side validation shared by the certification create and edit routes.
function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

// A real calendar date as YYYY-MM-DD, null when blank, undefined when invalid.
export function calendarDateOrNull(value: unknown): string | null | undefined {
  const result = text(value);
  if (!result) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(result);
  if (!match) return undefined;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toISOString().slice(0, 10) === result ? result : undefined;
}

export function certificationInputError(body: Record<string, unknown>) {
  const issueDate = calendarDateOrNull(body.issueDate);
  const expirationDate = calendarDateOrNull(body.expirationDate);
  if (issueDate === undefined || expirationDate === undefined) {
    return "Issue and expiration dates must be valid dates (YYYY-MM-DD).";
  }
  if (issueDate && expirationDate && expirationDate < issueDate) {
    return "The expiration date cannot be before the issue date.";
  }
  const documentUrl = text(body.documentUrl);
  if (documentUrl && !/^https?:\/\/\S+$/i.test(documentUrl)) {
    return "The document link must be an http or https URL.";
  }
  return null;
}
