import assert from 'node:assert/strict';
import {test} from 'node:test';
import {authenticationMappingManifest,reconcileAuthenticationMappings} from './authentication-mapping-manifest.mjs';
const user='11111111-1111-4111-8111-111111111111',subject='22222222-2222-4222-8222-222222222222',department='33333333-3333-4333-8333-333333333333';
const before={profiles:[user],memberships:[{userId:user,departmentId:department,roleCode:'officer'}],links:[{provider:'supabase',issuer:'https://synthetic.supabase.co',subject:user,userId:user,state:'active'}]};
const link={provider:'cognito',issuer:'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_Synthetic',subject,userId:user,state:'pending'};
test('adding a pending provider link preserves existing users and department permissions',()=>{
 const result=reconcileAuthenticationMappings(before,{...before,links:[...before.links,link]});assert.equal(result.addedMappings,1);assert.equal(result.departmentPermissionsPreserved,true);assert.equal(JSON.stringify(result).includes(user),false);
});
test('role escalation, identity reassignment and duplicate provider links are rejected',()=>{
 assert.throws(()=>reconcileAuthenticationMappings(before,{...before,memberships:[{...before.memberships[0],roleCode:'administrator'}]}),/permission drift/);
 assert.throws(()=>reconcileAuthenticationMappings(before,{...before,links:[]}),/mapping changed/);
 assert.throws(()=>authenticationMappingManifest({...before,links:[...before.links,link,link]}),/Duplicate/);
 assert.throws(()=>authenticationMappingManifest({...before,links:[{...link,userId:subject}]}),/Invalid/);
});
