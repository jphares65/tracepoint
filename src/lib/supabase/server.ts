import { createServerClient } from "@supabase/ssr";
import { cookies, headers } from "next/headers";

import { readBearerToken } from "@/lib/authentication/request-bearer";
import type { Database } from "./database.types";

export async function createClient() {
  const cookieStore = await cookies();
  const accessToken = readBearerToken((await headers()).get("authorization"));

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.",
    );
  }

  return createServerClient<Database>(url, publishableKey, {
    global: accessToken
      ? { headers: { Authorization: `Bearer ${accessToken}` } }
      : undefined,
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Server Components cannot write cookies.
          // The root proxy refreshes sessions when auth is activated.
        }
      },
    },
  });
}

