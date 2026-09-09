export type AuthenticatedPrincipal = {
  userId: string;
  provider: "supabase" | "cognito";
  issuer: string;
  subject: string;
  email: string;
  fullName: string;
};

const handlePattern = /^[A-Za-z0-9_-]{43}$/;

export function uniqueCookieValue(cookieHeader: string | null, name: string) {
  const values = (cookieHeader ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${name}=`))
    .map((part) => part.slice(name.length + 1));
  if (values.length === 0) return null;
  if (values.length !== 1 || !handlePattern.test(values[0])) throw new Error("Invalid application session cookie.");
  return values[0];
}

export function runtimeAuthenticationProvider(environment: Record<string,string|undefined>) {
  const mode = environment.TRACEPOINT_RUNTIME_PROVIDER_MODE ?? "bridge";
  const provider = environment.TRACEPOINT_AUTH_PROVIDER ?? "supabase";
  if (mode === "aws-native" && provider === "cognito") return "cognito" as const;
  if (mode === "bridge" && provider === "supabase") return "supabase" as const;
  throw new Error("Authentication provider tuple is invalid.");
}
