export type ReadResult = { data: any; error: { message: string } | null };
export interface OffDutyReadDataSource {
  listRequests(departmentId: string, officerUserId?: string): PromiseLike<ReadResult>;
  listHistory(departmentId: string, requestIds: string[]): PromiseLike<ReadResult>;
  listInspections(departmentId: string, requestIds: string[]): PromiseLike<ReadResult>;
  getRules(departmentId: string): PromiseLike<ReadResult>;
  listProfiles(userIds: string[]): PromiseLike<ReadResult>;
  listMemberships(departmentId: string, userIds: string[]): PromiseLike<ReadResult>;
  getRequest(departmentId: string, requestId: string): PromiseLike<ReadResult>;
  listRequestInspections(departmentId: string, requestId: string): PromiseLike<ReadResult>;
}
export class OffDutyReadAuthorizationError extends Error {}
export class OffDutyReadRepositoryError extends Error {}
export function requireOffDutyReadProvider(value?: string) { const provider=value?.trim().toLowerCase()||"supabase"; if(provider!=="supabase") throw new Error(`Unsupported data provider: ${provider}. Only supabase is implemented.`); return provider; }
export class TenantBoundOffDutyReadRepository {
  private source: OffDutyReadDataSource;
  private departmentId: string;
  constructor(source: OffDutyReadDataSource, departmentId: string) { this.source=source; this.departmentId=departmentId; if(!departmentId) throw new OffDutyReadAuthorizationError(); }
  private check(id:string){if(id!==this.departmentId) throw new OffDutyReadAuthorizationError();}
  private async rows(result:PromiseLike<ReadResult>){const value=await result;if(value.error)throw new OffDutyReadRepositoryError(value.error.message);return Array.isArray(value.data)?value.data:[];}
  private async row(result:PromiseLike<ReadResult>){const value=await result;if(value.error)throw new OffDutyReadRepositoryError(value.error.message);return value.data??null;}
  listRequests(id:string, officer?:string){this.check(id);return this.rows(this.source.listRequests(id,officer));}
  listHistory(id:string, ids:string[]){this.check(id);return ids.length?this.rows(this.source.listHistory(id,ids)):Promise.resolve([]);}
  listInspections(id:string, ids:string[]){this.check(id);return ids.length?this.rows(this.source.listInspections(id,ids)):Promise.resolve([]);}
  getRules(id:string){this.check(id);return this.row(this.source.getRules(id));}
  listProfiles(id:string, ids:string[]){this.check(id);return ids.length?this.rows(this.source.listProfiles(ids)):Promise.resolve([]);}
  listMemberships(id:string, ids:string[]){this.check(id);return ids.length?this.rows(this.source.listMemberships(id,ids)):Promise.resolve([]);}
  getRequest(id:string, requestId:string){this.check(id);return this.row(this.source.getRequest(id,requestId));}
  listRequestInspections(id:string, requestId:string){this.check(id);return this.rows(this.source.listRequestInspections(id,requestId));}
}
