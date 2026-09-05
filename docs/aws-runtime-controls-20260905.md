# Runtime operational validation

Image 7635a07c1c0cfb27f5611bc46ddedb5e9b9b8636, digest sha256:c26c45c22832d419a885c015c5ddb7b4af0bd131ac19898f70d38142dd2c75c8, was deployed as revision 8 and then revision 9 with the verified sender setting. The structural gate and live CDK diff admitted only the reviewed sender addition and task-definition retention. CloudFormation completed; all four alarms were OK at the rollback baseline.

A single application email-provider submission used the live revision 9 sender configuration. Brevo reported delivered at 2026-09-05T02:49:07Z for message <202609050249.92463940013@smtp-relay.mailin.fr>. No ambiguous retry occurred. This verifies provider delivery acceptance, not a human read.

The controlled rollback reached retained ACTIVE revision 8 and passed settled ECS 1/1/0, ALB healthy, login, health and protected-route checks. Return to revision 9 is being verified separately. Both revisions use the corrected image; revision 8 temporarily lacks the sender setting.

The ECS CLI waiter can return before rollout completion or target deregistration. The runtime verifier now accepts an explicit bounded wait while retaining exactly-one-task, completed-rollout and exactly-one-healthy-target requirements. Rollback uses this wait automatically.
