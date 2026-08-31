export const QUALIFICATION_HISTORY_FIELDS =
  "id,officer_user_id,qualification_date,lighting_condition,score,passed,record_origin,historical_qualification_type,historical_instructor_name,notes";

export type QualificationHistoryRow = {
  id: string;
  officer_user_id: string;
  qualification_date: string;
  lighting_condition: string | null;
  score: number | string | null;
  passed: boolean;
  record_origin: string;
  historical_qualification_type: string | null;
  historical_instructor_name: string | null;
  notes: string | null;
};

export type QualificationHistoryResult = {
  id: string;
  officerUserId: string;
  qualificationDate: string;
  lightingCondition: string | null;
  score: number | null;
  passed: boolean;
  recordOrigin: string;
  qualificationType: string | null;
  instructorName: string | null;
  notes: string | null;
};

export function mapQualificationHistoryRows(
  rows: QualificationHistoryRow[],
): QualificationHistoryResult[] {
  return rows.map((row) => ({
    id: row.id,
    officerUserId: row.officer_user_id,
    qualificationDate: row.qualification_date,
    lightingCondition: row.lighting_condition,
    score: row.score === null ? null : Number(row.score),
    passed: row.passed,
    recordOrigin: row.record_origin,
    qualificationType: row.historical_qualification_type,
    instructorName: row.historical_instructor_name,
    notes: row.notes,
  }));
}

type QueryResult = {
  data: QualificationHistoryRow[] | null;
  error: { message: string } | null;
};

type OrderedQuery = PromiseLike<QueryResult>;

type FilteredQuery = {
  eq(column: string, value: string): FilteredQuery;
  order(column: string, options: { ascending: boolean }): OrderedQuery;
};

export type QualificationHistorySupabaseClient = {
  from(table: "qualification_results"): {
    select(fields: string): FilteredQuery;
  };
};

export type QualificationHistoryInput = {
  departmentId: string;
};

export interface QualificationHistoryRepository {
  listImportedHistory(input: QualificationHistoryInput): Promise<QualificationHistoryRow[]>;
}

export class QualificationHistoryRepositoryError extends Error {
  constructor(message = "Qualification history could not be loaded.") {
    super(message);
    this.name = "QualificationHistoryRepositoryError";
  }
}

export class QualificationHistoryAuthorizationError extends Error {
  constructor() {
    super("Authorized department context is required.");
    this.name = "QualificationHistoryAuthorizationError";
  }
}

export class QualificationHistoryRepositoryConfigurationError extends Error {
  constructor(provider: string) {
    super(`Unsupported data provider: ${provider}. Only supabase is implemented.`);
    this.name = "QualificationHistoryRepositoryConfigurationError";
  }
}

export class SupabaseQualificationHistoryRepository implements QualificationHistoryRepository {
  private readonly client: QualificationHistorySupabaseClient;
  private readonly authorizedDepartmentId: string;

  constructor(client: QualificationHistorySupabaseClient, authorizedDepartmentId: string) {
    if (!authorizedDepartmentId) throw new QualificationHistoryAuthorizationError();
    this.client = client;
    this.authorizedDepartmentId = authorizedDepartmentId;
  }

  async listImportedHistory(input: QualificationHistoryInput) {
    if (!input.departmentId || input.departmentId !== this.authorizedDepartmentId) {
      throw new QualificationHistoryAuthorizationError();
    }

    const result = await this.client
      .from("qualification_results")
      .select(QUALIFICATION_HISTORY_FIELDS)
      .eq("department_id", input.departmentId)
      .eq("record_origin", "historical_import")
      .order("qualification_date", { ascending: false });

    if (result.error) throw new QualificationHistoryRepositoryError();
    return result.data ?? [];
  }
}

export function createQualificationHistoryRepository(
  client: QualificationHistorySupabaseClient,
  authorizedDepartmentId: string,
  environment?: { TRACEPOINT_DATA_PROVIDER?: string },
): QualificationHistoryRepository {
  const configured = environment
    ? environment.TRACEPOINT_DATA_PROVIDER
    : process.env.TRACEPOINT_DATA_PROVIDER;
  const provider = configured?.trim().toLowerCase() || "supabase";
  if (provider !== "supabase") {
    throw new QualificationHistoryRepositoryConfigurationError(provider);
  }
  return new SupabaseQualificationHistoryRepository(client, authorizedDepartmentId);
}
