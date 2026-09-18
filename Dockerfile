# syntax=docker/dockerfile:1
FROM node:24-trixie-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-trixie-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_SITE_URL
ARG DEPLOYMENT_VERSION
ARG TRACEPOINT_BUILD_PROVIDER_MODE=bridge
ARG NEXT_PUBLIC_TRACEPOINT_PROVIDER_MODE=bridge
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL
ENV DEPLOYMENT_VERSION=$DEPLOYMENT_VERSION
ENV TRACEPOINT_BUILD_PROVIDER_MODE=$TRACEPOINT_BUILD_PROVIDER_MODE
ENV NEXT_PUBLIC_TRACEPOINT_PROVIDER_MODE=$NEXT_PUBLIC_TRACEPOINT_PROVIDER_MODE
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
# Pin AWS's official global RDS trust bundle so database TLS verification does
# not depend on the base image's operating-system trust-store contents.
RUN node -e "fetch('https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem').then(r=>{if(!r.ok)throw new Error(String(r.status));return r.arrayBuffer()}).then(b=>require('fs').writeFileSync('/tmp/rds-ca.pem',Buffer.from(b)))" && \
    echo "e5bb2084ccf45087bda1c9bffdea0eb15ee67f0b91646106e466714f9de3c7e3  /tmp/rds-ca.pem" | sha256sum -c -
# BuildKit mounts the Server Action key for this instruction only. It is not a
# Docker ARG, ENV layer, or copied file. CI must read the same Secrets Manager
# JSON key that ECS injects when the task starts.
RUN --mount=type=secret,id=next_server_actions_encryption_key,required=true \
    NEXT_SERVER_ACTIONS_ENCRYPTION_KEY="$(cat /run/secrets/next_server_actions_encryption_key)" \
    npm run build

# Empty, owned volume seeds: Fargate otherwise initializes bind mounts as root.
RUN mkdir -p /runtime-volumes/cache /runtime-volumes/tmp && \
    touch /runtime-volumes/cache/.tracepoint-volume /runtime-volumes/tmp/.tracepoint-volume && \
    chown -R 65532:65532 /runtime-volumes

FROM gcr.io/distroless/nodejs24-debian13:nonroot AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
COPY --from=builder --chown=nonroot:nonroot /app/public ./public
COPY --from=builder --chown=nonroot:nonroot /app/.next/standalone ./
COPY --from=builder --chown=nonroot:nonroot /app/.next/static ./.next/static
COPY --from=builder --chown=nonroot:nonroot /tmp/rds-ca.pem /app/rds-ca.pem
COPY --chown=nonroot:nonroot scripts/validate-tracepoint-runtime-config.mjs ./validate-tracepoint-runtime-config.mjs
COPY --chown=nonroot:nonroot scripts/start-tracepoint-container.mjs ./start-tracepoint-container.mjs
COPY --from=builder --chown=nonroot:nonroot /runtime-volumes/cache /app/.next/cache
COPY --from=builder --chown=nonroot:nonroot /runtime-volumes/tmp /tmp
USER nonroot
VOLUME ["/app/.next/cache", "/tmp"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:3000/api/health',{cache:'no-store'}).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["start-tracepoint-container.mjs"]
