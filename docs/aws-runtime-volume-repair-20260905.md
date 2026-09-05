# Non-root runtime volume repair

The revision 11 acceptance log sweep exposed EACCES mkdir failures under /app/.next/cache. These were filesystem errors, not database authorization failures. All four alarms remained OK and the authenticated range/document suite passed, so HTTP status checks alone had missed the cache failure.

The image now provides explicitly owned cache and temporary volume directories and matching Dockerfile VOLUME declarations. Both build specifications run the image as UID/GID 65532 with a read-only root filesystem and fresh volumes, verify writes/deletes in both mounts, and verify writes under /app are denied before pushing an image. Runtime permissions and the CDK template remain unchanged. The actual container gate and live cache behavior must pass in the next release.

[Amazon ECS bind mount behavior](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/bind-mounts.html) specifies root ownership by default and Dockerfile volume ownership initialization. The installed Next.js self-hosting guide confirms filesystem cache use.

Live validation completed: image ccdfa225bdb54542f49906632bfe93b584c1a177, digest sha256:e600bc1bd2253b8960fcd3c3e7fd5ffefd5aac3ff2f71bda34ee3b3fa535032d, task revision 12. CodeBuild 81b8ba89-7775-46ae-9538-1eae0fe0251b passed the actual non-root volume gate and ECR scan COMPLETE with zero findings. The structural/live CDK diff was image-only; CloudFormation UPDATE_COMPLETE, ECS 1/1/0 completed, one healthy ALB target, four alarms OK. Authenticated run df4f6ada-7fc4-402f-8599-9a7c77797eac passed all implemented range/document/custody/private-storage scenarios, with audit and zero-fixture cleanup verified. Current-task log collection after acceptance found zero errors and zero EACCES failures.

The first deployment attempt stopped at the stdin JSON transport gate before deployment. Explicit UTF-8 without a BOM restored provider validation; the release wrapper now sets that encoding. No provider secret was changed.
