export type DocumentContextType = "person" | "firearm" | "qualification";
export type ContextAnalysis = { required: readonly DocumentContextType[]; primary: DocumentContextType | null; inferred: readonly DocumentContextType[] };
export function analyzeDocumentContext(keys: readonly (string | null | undefined)[]): ContextAnalysis {
  const set = new Set(keys.filter((key): key is string => Boolean(key)));
  const person = [...set].some((key) => key.startsWith("person.")); const firearm = [...set].some((key) => key.startsWith("firearm.")); const qualification = [...set].some((key) => key.startsWith("qualification."));
  if (firearm) return { required: qualification ? ["firearm", "qualification"] : ["firearm"], primary: "firearm", inferred: person ? ["person"] : [] };
  if (person) return { required: qualification ? ["person", "qualification"] : ["person"], primary: "person", inferred: [] };
  return qualification ? { required: ["qualification"], primary: "qualification", inferred: [] } : { required: [], primary: null, inferred: [] };
}
