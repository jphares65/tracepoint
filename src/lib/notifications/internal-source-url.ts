export function internalSourceUrl(
  path: string,
  requestUrl: string,
  runtimeMode: string | undefined,
  runtimePort: string | undefined,
): URL {
  if (!/^\/api\/[a-z0-9/-]+$/.test(path)) {
    throw new Error("Invalid internal notification source path.");
  }
  if (runtimeMode !== "aws-native") return new URL(path, requestUrl);
  const port = Number(runtimePort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Invalid AWS-native runtime port.");
  }
  return new URL(path, `http://127.0.0.1:${port}`);
}
