# Pushed overnight implementation commits

Branch: codex/aws-staging-readiness-20260902. Starting checkpoint: 5df4247. The following exact commits are pushed through the final implementation slice. Subsequent evidence-only checkpoint commits are visible with `git log --reverse 5df4247..origin/codex/aws-staging-readiness-20260902`; the final report supplies the final branch SHA.

```text
dbfcca9f2617cdcbad28a77b510d4f7e1f82c0f0 Configure verified staging sender and preserve rollback task definitions
48af7c73df2318f2898b6528a4062664f98415e6 Handle CDK progress stderr during strict PowerShell synthesis
5d36c1cceedb4980d4e7c84150582fd1e41e9631 Restore missing feature entitlement schema and validate live authenticated routes
9884412e1f586ce6de9c814d6492f63036f6120d Exercise live custody, Officer visibility, permission denials and audit history
a60cf6f2f7cbb112e30247043f5a1d8873c503e0 Wait for settled rollback health and record verified Brevo delivery
7b9778630138f48883cc65afde393a10f3282a8c Implement tenant-bound private S3 storage, delivery and reconciliation gates
71a9222f7c87f8e938e80e1b2a2b74c0ebc0094d Gate staging S3 activation and record live storage and rollback evidence
a836422fb06efe34803a427944d0a94d65196182 Verify authenticated private storage and checkpoint measured migration progress
3db2faba39f1816dc812c14186e48d87c4ea6ef3 Restore range workspace schema and enforce bulk-write permissions and history
683c3601bc0141d5bf511706bde3c24467639e80 Implement disabled SES suppression persistence and signed feedback processing
ccdfa225bdb54542f49906632bfe93b584c1a177 Initialize writable non-root ECS volumes and verify them before image publication
446753d9c6d3b2ec7c12112d9e460ced7c34271e Reconcile live staging rows and schema through a guarded management connection
0f7bbc248628250c16407b3591e549fc0615fbd4 Rehearse live Supabase-to-S3 copy reconciliation and version-scoped rollback
c9b17dd45dd335578787ce7c0c0b0a8f1e989658 Gate S3 releases with disposable acceptance and current-task operational evidence
5daf892a413062f744b379520a52b9ecf9d0fb83 Introduce server authentication boundary and disabled Cognito identity verification
3ac59c5a1cccd79d4fd534212ce8973abeaecd98 Move staging container to supported Node 24 LTS and verify runtime version
03bc8309da42b3123ac220debd7edbd94135f858 Prepare isolated Cognito and SES infrastructure previews
34633a75d23c6edcd7aca364506159624a48ab28 Repair staging armory schema and authenticated certification management
31c782f56532811a382ec91f5247dc2bbe6fc88b Prepare durable SES feedback queues and partial-batch processing
b35b8255c2df3501c77c6437bf4e8f4df28344a0 Enforce tenant and inspector access for firearm checklists
855a9ae4c48e3b51951a19d067c44107d8b9a0e9 Automate exact-version rollback rehearsal and require zero scan findings
21e8c7b107a5185ecf705b3d602f64750c845334 Add encrypted staging alarm fanout and durable delivery receipts
e68578c769b9d25f81e5178270dc26e57223e962 Verify live alarm delivery, extended acceptance and exact-version recovery
0a404ccc43f21d9321fddb45566cc2c53a42cc75 Fix ECS authentication callback origins and reject external redirects
e5f3a3d5c9709c086b16446dc7434a22cd798e30 Prepare isolated AWS PostgreSQL bootstrap and restore rehearsal
cf0a0c88da35a0824600f356f7bbdb34ab3130d9 Gate disposable PostgreSQL execution and cleanup by exact ownership
5a511edbf2d1543fd384f0ed11734a548d6272e7 Fix staging logout origin and guarantee acceptance fixture cleanup
8e587b9648533ed53f213203e473b1b6a603e5bf Match logged-out recovery check to protected route contract
ed7e0329a4e312e2f0c6bdc149f8c9c65090806f Use a minimal PostgreSQL client runner with package scan metadata
7202985387ec40bbb417122d91452b8a24a51eda Resolve strict rehearsal image policy gate and record stopped attempt
0bd6b1baf11dc0b0500fd43a107402878a2831bd Record accepted revision 16 and live authentication recovery evidence
aca54c1c9717f8a0511809fd5c080b7daaac8fba Add staged WAF rate controls with redacted logs and live proof gates
bff6d200c343ea05905aa3229688eeb785fbe36b Record disposable RDS cleanup and add sanitized rehearsal phase diagnostics
ee1f92c8523a1eeffaa8a2122650e4956aaa8365 Revert failed WAF enforcement and exercise bounded authenticated concurrency
d7d85c58e757cd1ff0aa23f6e7c894b2c0cbd4c7 Record revision 16 rollback timing and account for pending WAF costs
2347f6115170261c95f5323b1241c39274fb4f43 Add environment-scoped GitHub OIDC staging release foundation
194e0ca4f341599ab42c673dc5ab9f9172d5f024 Verify WAF count mode and require bounded rate-limit recovery
46f11f823b409d0379ee58c976a4b3f28b8cae8e Canonicalize restored constraint metadata and validate complete local manifests
d1b559abf6121d1d52372a9f9f3d49d7d55ab4bd Exercise environment-scoped OIDC against the accepted staging runtime
41a100a7a72f46866b99c6e6e1bc8b642a2572cb Record live WAF acceptance and connect flood alarm to incident fanout
da0b5c5d83df2b4424bc7fbd0da238aa817f59de Prepare disabled Cognito PKCE and signed callback verification
fe82dfe08c0a4439d83ff69696fb70938978ba5d Checkpoint successful AWS PostgreSQL restore and GitHub OIDC proof
01e64db9bce0a010bd526e77eab4b092d76f927c Add encrypted durable Cognito transactions and revocation state behind disabled provider
0ad535f13c270e83be850274eda2aecbefa80c87 Prevent uncertain email resends and gate deliberate OIDC staging releases
0b520e716871693f56e83a5bd8b5c3557e282f78 Request guarded OIDC staging release of the reviewed email fix
90830df0a7486bf5166c0b7c2bd4abe0b06686d3 Harden hosted PostgreSQL tests and scope encrypted OIDC source publication
54f3ece2fd25271690512adc4d70a29a84a71f35 Run mandatory database validation unprivileged before Windows OIDC release
3357f101e5560c7cfca688997008148fa74b69a3 Return a successful shell status after completed negative release tests
d377ad176b99d6cc35f0c80ef679636caca5cab7 Expose email reconciliation failures in HTTP and aggregate release health gates
432ebf0d52122df41c0d7e793c09029fbc54b40f Request the validated OIDC staging release with email reconciliation controls
1491a417de1f9dbfc95d7a44abd05cd9d06d95f6 Permit CDK telemetry drift while preserving runtime structural gate
38cecaae6e98b5cc7a0b8cb2ee2b62196fdac3d1 Prepare disabled staging SES foundation with bounded cost and no runtime send authority
7388c4f7071fa232e05664ef821cb0ce49fe5fef Resume immutable staging releases only when runtime source is unchanged
ae1049ad5ee0d69df3a7d08309cff84f4960a69a Gate controlled CI rollback and require production schema compatibility evidence
4d80c789af6cc3c0f6d5efd04efd90509976c615 Record accepted revision 17 and disabled SES live foundation evidence
8b91f7c37cf30e28848f82b320b7ad1e87aaba05 Request OIDC resume and controlled rollback of accepted staging image
572853589feaddf57708ab4e3384b90e5f42807a Make disabled SES and actual staging cost evidence repeatable
fc4bb470e841ad1f279d2986a38c0788e2089562 Allow guarded OIDC rollback to pass only existing staging ECS roles
336033e56bcbb93d681edf319c52161bfbd40a36 Parameterize production assembly behind exact account role and expiring authority gates
7caf20630c047635191c357bfd51898db95e796d Prepare safety-gated production image publication with offline archive validation
2cacdf016ece798f9d742b911c2e54be15183a62 Prepare isolated disabled Cognito foundation for disposable MFA rehearsal
6ce54fb5f02cba76a4d2cccee3bfa01a009b12fe Record successful OIDC release and timed revision 17 rollback rehearsal
2f68fd15bbdf5e2905ad37ec5e55baf368f71524 Use Cognito Essentials to retain refresh rotation and adopt the empty retained pool
6c5eb9176555c363358e4db9783d7454adc66bf7 Rehearse disabled Cognito MFA PKCE rotation and revocation live
16d1fd4294b0e818c4731a31d4f83bbf723e5327 Compose disabled Cognito initial callbacks with durable session registration
```
