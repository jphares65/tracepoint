import { assertLeaseOnlyChangeSet } from "./database-lease-governance-core.mjs";
let text='';for await(const part of process.stdin)text+=part;try{assertLeaseOnlyChangeSet(JSON.parse(text));console.log('Lease-only change set accepted.')}catch{console.error('Lease change set contains an unapproved change.');process.exitCode=1;}
