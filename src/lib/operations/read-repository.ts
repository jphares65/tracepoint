import "server-only";
import { getPostgresPool } from "../database/postgres-pool";
import { requireOperationsReadProvider, TenantBoundOperationsReadRepository } from "./read-repository-core";
import { PostgresOperationsReadDataSource } from "./read-repository-postgres";
import { SupabaseOperationsReadDataSource, type OperationsClient } from "./read-repository-supabase";

export function createOperationsReadRepository(client:OperationsClient|null,id:string,subjectId?:string){
 const provider=requireOperationsReadProvider(process.env.TRACEPOINT_DATA_PROVIDER);
 if(provider==="postgres"){
  if(!subjectId)throw new Error("Authenticated PostgreSQL subject is required.");
  return new TenantBoundOperationsReadRepository(new PostgresOperationsReadDataSource(getPostgresPool(),subjectId),id);
 }
 if(!client)throw new Error("Supabase operations client is required.");
 return new TenantBoundOperationsReadRepository(new SupabaseOperationsReadDataSource(client),id);
}
