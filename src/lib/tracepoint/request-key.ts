// One request key per intended action (D-65, C-07). Resubmitting the same values,
// for example after a lost connection, reuses the key, so the server returns
// the record it already wrote instead of writing a second one. Changed values
// are a new action and get a new key; a recorded action clears it.
export type RequestKeyStore = { current: { signature: string; key: string } | null };

export function requestKeyFor(store: RequestKeyStore, payload: unknown) {
  const signature = JSON.stringify(payload);
  if (store.current?.signature !== signature)
    store.current = { signature, key: crypto.randomUUID() };
  return store.current.key;
}

export function clearRequestKey(store: RequestKeyStore) {
  store.current = null;
}

export const LOST_CONNECTION_MESSAGE =
  "The connection was lost before TracePoint answered. Try again: the same request is recorded only once.";
