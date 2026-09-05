# Non-root runtime volume repair

The revision 11 acceptance log sweep exposed EACCES mkdir failures under /app/.next/cache. These were filesystem errors, not database authorization failures. All four alarms remained OK and the authenticated range/document suite passed, so HTTP status checks alone had missed the cache failure.

The image now provides explicitly owned cache and temporary volume directories and matching Dockerfile VOLUME declarations. Both build specifications run the image as UID/GID 65532 with a read-only root filesystem and fresh volumes, verify writes/deletes in both mounts, and verify writes under /app are denied before pushing an image. Runtime permissions and the CDK template remain unchanged. The actual container gate and live cache behavior must pass in the next release.

[Amazon ECS bind mount behavior](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/bind-mounts.html) specifies root ownership by default and Dockerfile volume ownership initialization. The installed Next.js self-hosting guide confirms filesystem cache use.
