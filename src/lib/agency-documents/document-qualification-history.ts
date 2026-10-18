import type { QualificationRecord } from "./structured-binding";

export const DOCUMENT_QUALIFICATION_FIELDS = "id,officer_user_id,qualification_date,score,passed,historical_course_name,historical_instructor_name,historical_qualification_type";

export type DocumentQualificationRow = {
  id: string;
  officer_user_id: string;
  qualification_date: string;
  score: number | string | null;
  passed: boolean | null;
  historical_course_name: string | null;
  historical_instructor_name: string | null;
  historical_qualification_type: string | null;
};
export type DocumentQualificationProviderError = { message: string };
export type DocumentQualificationResult<T> = { data: T | null; error: DocumentQualificationProviderError | null };
export type DocumentQualificationHistoryClient = {
  from(table: "department_memberships"): { select(fields: string): { eq(column: string, value: string | boolean): { eq(column: string, value: string | boolean): { eq(column: string, value: string | boolean): { maybeSingle(): PromiseLike<DocumentQualificationResult<{ user_id: string }>> } } } } };
  from(table: "qualification_results"): { select(fields: string): { eq(column: string, value: string): { eq(column: string, value: string): { order(column: string, options: { ascending: boolean }): PromiseLike<DocumentQualificationResult<DocumentQualificationRow[]>> } } } };
};

export class DocumentQualificationHistoryAuthorizationError extends Error {
  constructor() { super("Selected officer is not available."); this.name = "DocumentQualificationHistoryAuthorizationError"; }
}
export class DocumentQualificationHistoryRepositoryError extends Error {
  constructor() { super("Qualification history could not be loaded."); this.name = "DocumentQualificationHistoryRepositoryError"; }
}
export class DocumentQualificationHistoryRepositoryConfigurationError extends Error {
  constructor(provider: string) { super(`Unsupported data provider: ${provider}. Only supabase is implemented.`); this.name = "DocumentQualificationHistoryRepositoryConfigurationError"; }
}

export function qualificationRecordFromHistoryRow(row: DocumentQualificationRow): QualificationRecord {
  return {
    id: row.id,
    date: row.qualification_date,
    ...(row.historical_course_name ? { courseName: row.historical_course_name } : {}),
    ...(row.passed === null ? {} : { result: row.passed ? "Pass" : "Fail" }),
    ...(row.score === null ? {} : { score: Number(row.score) }),
    ...(row.historical_instructor_name ? { instructor: row.historical_instructor_name } : {}),
    ...(row.historical_qualification_type ? { firearmType: row.historical_qualification_type } : {}),
  };
}

export class DocumentQualificationHistoryRepository {
  constructor(private readonly client: DocumentQualificationHistoryClient, private readonly departmentId: string) {
    if (!departmentId) throw new DocumentQualificationHistoryAuthorizationError();
  }

  async getQualificationHistoryForDocumentContext(input: { personId: string }): Promise<QualificationRecord[]> {
    if (!input.personId) throw new DocumentQualificationHistoryAuthorizationError();
    const membership = await this.client.from("department_memberships").select("user_id").eq("department_id", this.departmentId).eq("user_id", input.personId).eq("is_active", true).maybeSingle();
    if (membership.error) throw new DocumentQualificationHistoryRepositoryError();
    if (!membership.data) throw new DocumentQualificationHistoryAuthorizationError();
    const rows = await this.client.from("qualification_results").select(DOCUMENT_QUALIFICATION_FIELDS).eq("department_id", this.departmentId).eq("officer_user_id", input.personId).order("qualification_date", { ascending: false });
    if (rows.error) throw new DocumentQualificationHistoryRepositoryError();
    return (rows.data ?? []).map(qualificationRecordFromHistoryRow);
  }
}
export function createDocumentQualificationHistoryRepository(client: DocumentQualificationHistoryClient, departmentId: string, environment?: { TRACEPOINT_DATA_PROVIDER?: string }): DocumentQualificationHistoryRepository {
  const provider = (environment ? environment.TRACEPOINT_DATA_PROVIDER : process.env.TRACEPOINT_DATA_PROVIDER)?.trim().toLowerCase() || "supabase";
  if (provider !== "supabase" && provider !== "postgres") throw new DocumentQualificationHistoryRepositoryConfigurationError(provider);
  return new DocumentQualificationHistoryRepository(client, departmentId);
}
