export const MAX_AMMUNITION_WORKSPACE_BODY_BYTES = 16 * 1024;

export class AmmunitionWorkspaceBodyTooLarge extends Error {
  constructor() {
    super("Ammunition workspace payload exceeds 16 KiB.");
  }
}

export async function readAmmunitionWorkspaceBody(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new SyntaxError("Missing request body");

  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_AMMUNITION_WORKSPACE_BODY_BYTES) {
        await reader.cancel();
        throw new AmmunitionWorkspaceBodyTooLarge();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}
