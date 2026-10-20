// NEW-ARM-A: /api/armory/ammunition and /reconciliations call admin.auth.admin.listUsers; in aws-native mode admin is a PostgresDataClient.
const CUR = "/tmp/claude-0/-home-user/37d8642d-fcb5-5f5b-86e8-f46de44d221c/scratchpad/current";
const { PostgresDataClient } = await import(`${CUR}/src/lib/database/postgres-data-client.ts`);
const admin: any = new PostgresDataClient({ connect: async () => { throw new Error("no db needed"); } } as never, "dddddddd-0000-4000-8000-000000000004", "aaaaaaaa-0000-4000-8000-000000000001");
console.log("typeof admin.auth =", typeof admin.auth);
// Same expression as src/app/api/armory/ammunition/route.ts:43 and reconciliations/route.ts:115
async function loadLedgerShape() { return Promise.all([Promise.resolve({ data: [] }), admin.auth.admin.listUsers({ page: 1, perPage: 1000 })]); }
try { await loadLedgerShape(); console.log("no error"); } catch (e) { console.log("=>", (e as Error).name + ":", (e as Error).message, "-> route catch returns HTTP 500 with this message"); }
