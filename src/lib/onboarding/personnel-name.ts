function normalize(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function getLookupLastName(value: string) {
  const cleaned = value.trim();

  if (cleaned.includes(",")) {
    return cleaned.split(",")[0].trim();
  }

  const parts = cleaned.split(/\s+/);
  return parts[parts.length - 1];
}

export function matchesPersonnelName(
  fullName: string | null,
  lookupName: string,
) {
  if (!fullName) return false;

  const candidate = normalize(fullName);
  const lookup = normalize(lookupName);

  if (candidate === lookup) return true;

  let candidateFirst = "";
  let candidateLast = "";

  if (candidate.includes(",")) {
    const [last, first = ""] = candidate.split(",");
    candidateLast = last.trim();
    candidateFirst = first.trim().split(/\s+/)[0] ?? "";
  } else {
    const parts = candidate.split(/\s+/);
    candidateFirst = parts[0] ?? "";
    candidateLast = parts[parts.length - 1] ?? "";
  }

  if (lookup.includes(",")) {
    const [last, first = ""] = lookup.split(",");
    const lookupLast = last.trim();
    const lookupFirst = first.trim().replace(/\.$/, "");

    if (candidateLast !== lookupLast) return false;

    if (!lookupFirst) return true;

    if (lookupFirst.length === 1) {
      return candidateFirst.startsWith(lookupFirst);
    }

    return candidateFirst === lookupFirst;
  }

  const lookupParts = lookup.split(/\s+/);

  if (lookupParts.length === 1) {
    return candidateLast === lookup;
  }

  const lookupFirst = lookupParts[0];
  const lookupLast = lookupParts[lookupParts.length - 1];

  return (
    candidateLast === lookupLast &&
    (candidateFirst === lookupFirst ||
      candidateFirst.startsWith(lookupFirst))
  );
}