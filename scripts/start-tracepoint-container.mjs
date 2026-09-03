import { validateTracePointRuntimeConfig } from "./validate-tracepoint-runtime-config.mjs";

try {
  validateTracePointRuntimeConfig();
} catch (error) {
  console.error(error instanceof Error ? error.message : "TracePoint runtime configuration is invalid.");
  process.exit(1);
}

await import("./server.js");
