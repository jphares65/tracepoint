# Supported Node runtime

Node 20 is EOL as of this execution date. The container builder/dependency stages now use Node 24 on Debian 13 and the runtime uses Distroless Node 24 Debian 13 as the existing non-root UID. Both image build specifications require Node major 24 in the actual container, alongside writable-volume and read-only-root checks, before publication. Local application tests and Next production builds already run on Node 24.15.0. Image scanning and live staging acceptance remain mandatory before treating the upgraded container as validated.

Sources: [Node.js releases](https://nodejs.org/en/about/previous-releases), [Distroless supported images](https://github.com/GoogleContainerTools/distroless), [official Node Debian 13 Dockerfile](https://github.com/nodejs/docker-node/blob/main/24/trixie-slim/Dockerfile).
