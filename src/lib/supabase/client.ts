import { createBrowserClient } from "@supabase/ssr";

import type { Database } from "./database.types";

function requireBrowserEnvironment() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.",
    );
  }

  return { url, publishableKey };
}

export function createClient() {
  const { url, publishableKey } = requireBrowserEnvironment();

  return createBrowserClient<Database>(url, publishableKey);
}
