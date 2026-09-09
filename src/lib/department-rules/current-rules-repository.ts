import "server-only";
import { getPostgresPool } from "../database/postgres-pool";
import { createCurrentRulesRepositoryForProvider,type CurrentRulesSupabaseClient } from "./current-rules-repository-core";
export * from "./current-rules-repository-core";
export function createCurrentRulesRepository(client:CurrentRulesSupabaseClient|null,departmentId:string,subjectId?:string){
 const provider=process.env.TRACEPOINT_DATA_PROVIDER?.trim().toLowerCase()||"supabase";
 return createCurrentRulesRepositoryForProvider(client,departmentId,{TRACEPOINT_DATA_PROVIDER:provider,subjectId,postgresPool:provider==="postgres"?getPostgresPool():undefined});
}
