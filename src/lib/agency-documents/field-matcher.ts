import { getDocumentField } from "./field-registry";

/**
 * Deterministic form-label → TracePoint field matching.
 *
 * Design rules (accuracy over coverage):
 * - Only an exact phrase match (after normalization) is marked "exact" and may
 *   be pre-confirmed. Everything weaker is a "suggested" match that a person
 *   must confirm before the template can be published.
 * - Labels containing role/ownership words that change *whose* value belongs
 *   in the box (signature, supervisor, witness, instructor, emergency contact,
 *   date of birth, ...) never auto-match a person/agency field.
 * - When more than one TracePoint field plausibly fits, the result is a
 *   suggestion with alternatives — never a silent choice.
 * - No statistical or AI inference happens here. Same input → same output.
 */

export type MatchStatus = "exact" | "suggested" | "unmatched";

export type FieldMatch = {
  status: MatchStatus;
  key?: string;
  confidence: number;
  reason: string;
  alternatives: string[];
  normalizedLabel: string;
};

export type LearnedMapping = {
  normalizedLabel: string;
  /** A registry key, or null when the agency chose manual entry for this label. */
  key: string | null;
  templateName?: string;
};

const ABBREVIATIONS: Record<string, string[]> = {
  no: ["number"], num: ["number"], nbr: ["number"], nmbr: ["number"], "#": ["number"],
  ofc: ["officer"], ofcr: ["officer"], offcr: ["officer"], officers: ["officer"], members: ["member"], employees: ["employee"],
  dept: ["department"], dpt: ["department"], agcy: ["agency"],
  mfr: ["manufacturer"], mfg: ["manufacturer"], manuf: ["manufacturer"], manu: ["manufacturer"],
  cal: ["caliber"], calibre: ["caliber"], ser: ["serial"], sn: ["serial", "number"], sno: ["serial", "number"],
  qual: ["qualification"], quals: ["qualification"], qualif: ["qualification"],
  dob: ["date", "of", "birth"], ssn: ["social", "security", "number"],
  fname: ["first", "name"], lname: ["last", "name"], fullname: ["full", "name"], mi: ["middle", "initial"],
  addr: ["address"], tel: ["phone"], ph: ["phone"], sig: ["signature"], sgn: ["signature"], signed: ["signature"],
  yr: ["year"], dt: ["date"], instr: ["instructor"], inst: ["instructor"], rnk: ["rank"],
  id: ["id"], emp: ["employee"], lt: ["lieutenant"], sgt: ["sergeant"], capt: ["captain"],
};

/** Widget-name prefixes that authoring tools prepend and that carry no meaning. */
const NOISE_PREFIXES = new Set(["txt", "text", "fld", "field", "tb", "tf", "cb", "chk", "check", "dd", "ddl", "lst", "opt", "rb", "frm", "form", "input"]);
const FILLER = new Set(["the", "of", "s", "please", "print", "printed", "enter", "here", "a", "an", "to", "be", "in", "for", "and", "or", "your", "this"]);

/** Words that mean the box belongs to someone/something other than the subject. */
const GLOBAL_BLOCKERS = ["signature", "initials", "initial", "notary", "witness", "sign"];
const OTHER_PERSON = ["supervisor", "supervising", "reviewing", "reviewer", "reviewed", "approving", "approver", "approved", "instructor", "chief", "director", "commander", "prepared", "preparer", "completed", "certifying", "certified", "emergency", "spouse", "contact", "witness", "former", "previous", "prior", "sergeant", "lieutenant", "captain", "requesting", "requester", "issuing", "receiving", "relative", "parent", "dealer", "seller", "buyer", "owner", "range", "master", "coordinator"];
const PERSONAL_DETAIL = ["birth", "home", "personal", "cell", "phone", "address", "street", "city", "zip", "ssn", "social", "security", "license", "height", "weight", "hair", "eye", "eyes", "race", "sex", "gender", "age"];

type Rule = {
  key: string;
  /** Exact label phrases (normalized tokens joined by spaces) that safely identify this field. */
  exact: string[];
  /** Phrases that, when contained in a longer label, suggest this field for review. */
  contains?: string[];
  /** Extra tokens that block this rule entirely. */
  blockers?: string[];
};

const PERSON_BLOCKERS = [...OTHER_PERSON, ...PERSONAL_DETAIL];

const RULES: Rule[] = [
  { key: "person.full_name", exact: ["officer name", "officer", "officers name", "name of officer", "member name", "employee name", "officer full name", "full name", "name officer", "officer name last first", "shooter name", "shooter", "name of member", "name of employee", "personnel name", "officer last first", "name last first"], contains: ["officer name", "member name", "employee name", "full name", "shooter name"], blockers: PERSON_BLOCKERS },
  { key: "person.first_name", exact: ["first name", "officer first name", "given name", "first"], contains: ["first name"], blockers: PERSON_BLOCKERS },
  { key: "person.last_name", exact: ["last name", "officer last name", "surname", "family name", "last"], contains: ["last name", "surname"], blockers: PERSON_BLOCKERS },
  { key: "person.badge_number", exact: ["badge number", "badge", "officer badge number", "shield number", "shield", "badge id", "badge number id", "officer badge"], contains: ["badge", "shield number"], blockers: PERSON_BLOCKERS },
  { key: "person.rank", exact: ["rank", "officer rank", "rank title", "title rank", "rank or title", "rank title"], contains: ["rank"], blockers: PERSON_BLOCKERS },
  { key: "person.email", exact: ["email", "e mail", "email address", "officer email", "work email"], contains: ["email"], blockers: [...OTHER_PERSON, "personal", "home"] },
  { key: "agency.name", exact: ["agency", "agency name", "department", "department name", "name of agency", "name of department", "police department", "law enforcement agency", "agency department", "agency department name", "department agency", "department agency name", "employing agency", "agency employing"], contains: ["agency name", "department name", "law enforcement agency"], blockers: ["head", "chief", "director", "address", "phone", "ori", "number", "code", "signature", "representative", "contact", "previous", "former", "prior", "other"] },
  { key: "agency.short_name", exact: ["agency abbreviation", "department abbreviation", "agency short name"], contains: [] },
  { key: "agency.ori", exact: ["ori", "ori number", "agency ori", "ori code", "agency ori number", "department ori"], contains: ["ori"], blockers: ["origin", "original"] },
  { key: "agency.address", exact: ["agency address", "department address", "address of agency"], contains: ["agency address", "department address"] },
  { key: "agency.chief_name", exact: ["chief of police", "chief", "police chief", "chief name", "name of chief", "chief of police name", "director", "agency head", "department head", "chief director"], contains: ["chief of police"], blockers: ["signature", "deputy", "assistant", "fire"] },
  { key: "firearm.manufacturer", exact: ["make", "manufacturer", "firearm make", "weapon make", "firearm manufacturer", "weapon manufacturer", "gun make", "make manufacturer"], contains: ["manufacturer"], blockers: ["ammunition", "ammo", "holster", "optic", "light", "sight", "vehicle", "car"] },
  { key: "firearm.model", exact: ["model", "firearm model", "weapon model", "gun model", "model number"], contains: [], blockers: ["ammunition", "ammo", "holster", "optic", "light", "sight", "vehicle", "car", "year"] },
  { key: "firearm.serial_number", exact: ["serial number", "serial", "firearm serial number", "weapon serial number", "gun serial number", "serial number firearm"], contains: ["serial number"], blockers: ["ammunition", "ammo", "holster", "optic", "light", "vehicle", "car", "vin", "radio", "taser", "lot"] },
  { key: "firearm.caliber", exact: ["caliber", "firearm caliber", "weapon caliber", "caliber gauge", "gauge caliber"], contains: ["caliber"], blockers: ["ammunition", "ammo"] },
  { key: "firearm.asset_number", exact: ["asset number", "asset tag", "property number", "inventory number", "asset", "property tag"], contains: ["asset number", "asset tag"], blockers: ["vehicle", "car", "radio"] },
  { key: "firearm.type", exact: ["firearm type", "weapon type", "type of firearm", "type of weapon", "gun type"], contains: ["firearm type", "weapon type"] },
  { key: "qualification.date", exact: ["qualification date", "date of qualification", "date qualified", "qualified date", "qualification date fired", "date fired"], contains: ["qualification date", "date of qualification"], blockers: ["next", "due", "expiration", "expires", "previous", "prior", "last"] },
  { key: "qualification.course_name", exact: ["course", "course name", "course of fire", "qualification course", "drill", "drill name", "course title"], contains: ["course of fire", "course name"] },
  { key: "qualification.score", exact: ["score", "qualification score", "total score", "final score", "points", "score points"], contains: ["score"], blockers: ["minimum", "passing", "required", "possible", "max", "maximum"] },
  { key: "qualification.result", exact: ["result", "pass fail", "qualification result", "pass or fail", "results", "pass fail result", "qualified pass fail"], contains: ["pass fail"], blockers: [] },
  { key: "qualification.instructor", exact: ["instructor", "instructor name", "range instructor", "firearms instructor", "qualifying instructor", "range master", "rangemaster"], contains: ["instructor name"], blockers: ["signature", "number", "certification", "supervising", "other", "all", "additional"] },
  { key: "document.report_year", exact: ["report year", "year", "reporting year", "calendar year", "year of report"], contains: ["report year", "reporting year"], blockers: ["birth", "model", "vehicle", "manufacture"] },
  { key: "document.report_date", exact: ["date", "report date", "date of report", "todays date", "today date", "date prepared", "date completed", "date submitted", "submission date", "date of submission"], contains: ["date of report", "report date"], blockers: ["birth", "hire", "qualification", "fired", "expiration", "expires", "issue", "issued", "due", "next", "purchase", "incident", "appointment", "academy"] },
  { key: "preparer.full_name", exact: ["prepared by", "completed by", "report prepared by", "name of person completing", "person completing form", "name of preparer", "preparer name", "preparer"], contains: ["prepared by", "completed by", "submitted by"], blockers: ["date", "rank", "badge", "title", "phone", "email"] },
  { key: "preparer.rank", exact: ["preparer rank", "prepared by rank", "rank of preparer", "preparer title", "title of preparer"], contains: ["preparer rank"] },
  { key: "preparer.badge_number", exact: ["preparer badge number", "prepared by badge number", "badge of preparer"], contains: ["preparer badge"] },
];

function splitCamel(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
}

/** Normalize a raw label (widget name, tooltip, or printed text) into comparable tokens. */
export function normalizeLabel(raw: string): string[] {
  const text = splitCamel(raw.normalize("NFKD").replace(/[̀-ͯ]/g, ""))
    .replace(/s\/n/gi, " sn ")
    .replace(/e-mail/gi, " email ")
    .replace(/pass\s*\/\s*fail/gi, " pass fail ")
    .replace(/#/g, " # ")
    .replace(/\[\d+\]/g, " ")
    .toLowerCase()
    .replace(/[’']s\b/g, "s")
    .replace(/[^a-z0-9#]+/g, " ")
    .trim();
  const raw_tokens = text.split(/\s+/).filter(Boolean);
  const tokens: string[] = [];
  raw_tokens.forEach((token, index) => {
    if (index === 0 && NOISE_PREFIXES.has(token) && raw_tokens.length > 1) return;
    const expanded = ABBREVIATIONS[token] ?? [token];
    for (const part of expanded) if (!FILLER.has(part)) tokens.push(part);
  });
  // "Officers" → "officers" is kept, but a trailing digit index ("serial 2") is separated for detection below.
  return tokens;
}

function containsPhrase(tokens: string[], phrase: string[]) {
  if (!phrase.length || phrase.length > tokens.length) return false;
  for (let start = 0; start + phrase.length <= tokens.length; start += 1) {
    if (phrase.every((part, offset) => tokens[start + offset] === part)) return true;
  }
  return false;
}

function hasAny(tokens: string[], words: readonly string[]) {
  return words.some((word) => tokens.includes(word));
}

/** Row words that carry a list index when joined to a number ("row1", "item2" in hierarchical names like Inventory.Row1.Serial). */
const ROW_TOKEN = /^(?:row|line|item|entry|record|firearm|weapon|gun)(\d{1,2})$/;

/** True when the label carries a list index, e.g. "Serial 2", "Make_3" or "Inventory.Row1.Serial", meaning it may be one row of a repeating list. */
export function numberedIndex(tokens: string[]): number | null {
  const digits = tokens.flatMap((token) => (/^\d{1,2}$/.test(token) ? [token] : ROW_TOKEN.exec(token)?.slice(1, 2) ?? []));
  return digits.length === 1 ? Number(digits[0]) : null;
}

/** Words in a label that explain an otherwise "other person" word for a given field. */
const EXPLAINED: Record<string, readonly string[]> = {
  "qualification.instructor": ["instructor", "range", "master", "rangemaster"],
  "agency.chief_name": ["chief", "director", "head"],
  "agency.address": ["address", "street", "city", "zip"],
  "preparer.full_name": ["prepared", "preparer", "completed", "submitted"],
  "preparer.rank": ["prepared", "preparer", "completed", "submitted"],
  "preparer.badge_number": ["prepared", "preparer", "completed", "submitted"],
};
const CONCERN_WORDS = [...OTHER_PERSON, ...PERSONAL_DETAIL];

/** Words in a label that suggest the value belongs to someone or something other than what `key` describes. */
function concernsFor(tokens: readonly string[], key: string | undefined) {
  const explained = new Set(key ? EXPLAINED[key] ?? [] : []);
  return [...new Set(tokens.filter((token) => CONCERN_WORDS.includes(token) && !explained.has(token)))];
}

/**
 * Match one form field. `labels` may contain several sources for the same
 * field (tooltip, short name, full hierarchical name, nearby heading). The
 * best exact result is used only when no other source contradicts it: a
 * signature word anywhere makes the field unmatched, and wording about another
 * person (supervisor, witness, ...) or a different TracePoint field in any
 * source downgrades the result to a suggestion for review.
 */
export function matchFieldLabel(labels: string | readonly string[], options: { fieldKind?: "text" | "checkbox" | "choice" | "signature"; learned?: readonly LearnedMapping[]; context?: readonly string[] } = {}): FieldMatch {
  const sources = (Array.isArray(labels) ? labels : [labels as string]).map((label) => label?.trim()).filter((label): label is string => Boolean(label));
  if (!sources.length) return { status: "unmatched", confidence: 0, reason: "The field has no readable label.", alternatives: [], normalizedLabel: "" };
  const results = sources.map((source) => matchSingle(source, options));
  const normalizedLabel = results.map((result) => result.normalizedLabel).find(Boolean) ?? "";
  const allTokens = [...sources, ...(options.context ?? [])].map((source) => normalizeLabel(source));
  if (options.fieldKind === "signature" || allTokens.slice(0, sources.length).some((tokens) => hasAny(tokens, GLOBAL_BLOCKERS))) {
    return { status: "unmatched", confidence: 0, reason: "Signature and initial boxes are never filled automatically.", alternatives: [], normalizedLabel };
  }
  const keyed = results.filter((result) => result.key);
  if (!keyed.length) return { ...results[0], normalizedLabel };
  const distinct = [...new Set(keyed.map((result) => result.key!))];
  const best = [...keyed].sort((a, b) => b.confidence - a.confidence)[0];
  if (distinct.length > 1) {
    return { status: "suggested", key: best.key, confidence: Math.min(best.confidence, 0.6), reason: `The field's labels point to different TracePoint fields (${distinct.map(label).join(", ")}). Confirm which one applies.`, alternatives: distinct.filter((key) => key !== best.key), normalizedLabel: best.normalizedLabel };
  }
  // A row number in any source (e.g. the full name "Inventory.Row2.SerialNumber" behind a plain "Serial Number" tooltip)
  // means the field may be one row of a list, so an exact match on another source is only a suggestion.
  const rowIndex = allTokens.slice(0, sources.length).map((tokens) => numberedIndex(tokens)).find((index) => index !== null);
  if (best.status === "exact" && rowIndex != null) {
    return { ...best, status: "suggested", confidence: Math.min(best.confidence, 0.6), reason: `This field looks like ${label(best.key!)}, but its name is numbered (${rowIndex}). It may be one row of a list rather than the selected record; confirm before using it.` };
  }
  // Any source (or the surrounding heading) that talks about another person or a personal detail contradicts the match.
  const concerns = [...new Set(allTokens.flatMap((tokens) => concernsFor(tokens, best.key)))];
  if (concerns.length) {
    return { ...best, status: "suggested", confidence: Math.min(best.confidence, 0.5), reason: `This field looks like ${label(best.key!)}, but its labels or section mention "${concerns.join(", ")}", so it may belong to someone else. Confirm before using it.` };
  }
  return best;
}

function label(key: string) {
  return getDocumentField(key)?.label ?? key;
}

function matchSingle(raw: string, options: { fieldKind?: "text" | "checkbox" | "choice" | "signature"; learned?: readonly LearnedMapping[] }): FieldMatch {
  const tokens = normalizeLabel(raw);
  const normalizedLabel = tokens.join(" ");
  if (!tokens.length) return { status: "unmatched", confidence: 0, reason: "The field has no readable label.", alternatives: [], normalizedLabel };
  if (options.fieldKind === "signature" || hasAny(tokens, GLOBAL_BLOCKERS)) {
    return { status: "unmatched", confidence: 0, reason: "Signature and initial boxes are never filled automatically.", alternatives: [], normalizedLabel };
  }
  if (options.fieldKind === "checkbox") {
    return { status: "unmatched", confidence: 0, reason: "Checkboxes are completed by the person generating the document.", alternatives: [], normalizedLabel };
  }

  // Decisions a person made on another template. They never bypass the other-person checks in matchFieldLabel.
  const index = numberedIndex(tokens);
  const core = tokens.filter((token) => !/^\d{1,2}$/.test(token) && !ROW_TOKEN.test(token));
  const coreText = core.join(" ");

  const learned = options.learned?.find((entry) => entry.normalizedLabel === normalizedLabel);
  if (learned) {
    if (learned.key === null) return { status: "unmatched", confidence: 0, reason: `Your agency previously chose manual entry for "${raw}"${learned.templateName ? ` on ${learned.templateName}` : ""}.`, alternatives: [], normalizedLabel };
    if (getDocumentField(learned.key)) {
      const where = learned.templateName ? ` on ${learned.templateName}` : "";
      // A short, generic label ("Name", "Badge") can mean a different person on another form; reuse the choice as a suggestion only.
      if (GENERIC_EXACT.has(coreText) || (core.length === 1 && !UNAMBIGUOUS_SINGLE.has(coreText))) return { status: "suggested", key: learned.key, confidence: 0.75, reason: `Your agency chose ${label(learned.key)} for "${raw}"${where}. The label is generic, so confirm it for this form.`, alternatives: [], normalizedLabel };
      return { status: "exact", key: learned.key, confidence: 0.99, reason: `Your agency confirmed this label as ${label(learned.key)}${where}.`, alternatives: [], normalizedLabel };
    }
  }

  const exactHits: string[] = [];
  const containsHits: string[] = [];
  const blockedHits: string[] = [];
  for (const rule of COMPILED_RULES) {
    if (!getDocumentField(rule.key)) continue;
    const blocked = rule.blockers ? hasAny(core, rule.blockers) : false;
    const exact = rule.exact.has(coreText);
    const contained = !exact && rule.contains.some((phrase) => containsPhrase(core, phrase));
    if ((exact || contained) && blocked) { blockedHits.push(rule.key); continue; }
    if (exact) exactHits.push(rule.key);
    else if (contained) containsHits.push(rule.key);
  }

  if (exactHits.length === 1 && index === null) {
    const key = exactHits[0];
    // One-word labels ("Badge", "Rank", "Score") say nothing about whose value it is; a person confirms them.
    const generic = GENERIC_EXACT.has(coreText) || (core.length === 1 && !UNAMBIGUOUS_SINGLE.has(coreText));
    if (generic) return { status: "suggested", key, confidence: 0.7, reason: `"${raw}" is a short, generic label. It most likely means ${label(key)}, but confirm it for this form.`, alternatives: [], normalizedLabel };
    return { status: "exact", key, confidence: 0.97, reason: `"${raw}" exactly matches ${label(key)}.`, alternatives: [], normalizedLabel };
  }
  if (exactHits.length === 1 && index !== null) {
    return { status: "suggested", key: exactHits[0], confidence: 0.6, reason: `"${raw}" is numbered (${index}). It may be one row of a list rather than the selected record; confirm before using it.`, alternatives: [], normalizedLabel };
  }
  const candidates = [...new Set([...exactHits, ...containsHits])];
  if (candidates.length) {
    return { status: "suggested", key: candidates[0], confidence: candidates.length > 1 ? 0.5 : 0.65, reason: candidates.length > 1 ? `"${raw}" could mean ${candidates.map(label).join(" or ")}. Choose the right one.` : `"${raw}" contains wording associated with ${label(candidates[0])}, but it is not an exact match.`, alternatives: candidates.slice(1), normalizedLabel };
  }
  if (blockedHits.length) {
    return { status: "unmatched", confidence: 0, reason: `"${raw}" resembles ${label(blockedHits[0])}, but its wording indicates a different person or detail, so it was not matched.`, alternatives: [], normalizedLabel };
  }
  if (core.length === 1 && core[0] === "name") {
    return { status: "suggested", key: "person.full_name", confidence: 0.55, reason: `"${raw}" does not say whose name it is. Confirm whether it is the selected officer.`, alternatives: ["preparer.full_name"], normalizedLabel };
  }
  return { status: "unmatched", confidence: 0, reason: `No TracePoint field reliably matches "${raw}".`, alternatives: [], normalizedLabel };
}

/** Single-word labels that cannot refer to anything else on a police form. */
const UNAMBIGUOUS_SINGLE = new Set(["ori"]);

/** Rule phrases are normalized with the same function as labels, so filler words and abbreviations never cause misses. */
const COMPILED_RULES = RULES.map((rule) => ({
  key: rule.key,
  blockers: rule.blockers,
  exact: new Set(rule.exact.map((phrase) => normalizeLabel(phrase).join(" ")).filter(Boolean)),
  contains: (rule.contains ?? []).map((phrase) => normalizeLabel(phrase)).filter((tokens) => tokens.length > 0),
}));

/** Exact phrases that are nonetheless too generic to pre-confirm on an unknown form. */
const GENERIC_EXACT = new Set(["officer", "date", "year", "make", "model", "first", "last", "result", "results", "course", "points", "asset", "director", "chief", "drill", "department", "shield"]);

/** Exposed for tests and the UI legend. */
export const MATCHER_RULE_KEYS = RULES.map((rule) => rule.key);
