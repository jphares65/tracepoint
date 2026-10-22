// RFC 6238 TOTP for the synthetic staging test accounts (Cognito requires MFA).
// The secret comes only from the environment; it is never stored or logged.
import { createHmac } from "node:crypto";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Decode(secret: string) {
  const clean = secret.replace(/[\s=-]/g, "").toUpperCase();
  let bits = "";
  for (const character of clean) {
    const value = BASE32.indexOf(character);
    if (value < 0) throw new Error("The TOTP secret is not valid base32.");
    bits += value.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) bytes.push(parseInt(bits.slice(index, index + 8), 2));
  return Buffer.from(bytes);
}

export function totp(
  secret: Buffer | string,
  { time = Date.now(), step = 30, digits = 6, algorithm = "sha1" }: { time?: number; step?: number; digits?: number; algorithm?: "sha1" | "sha256" | "sha512" } = {},
) {
  const key = typeof secret === "string" ? base32Decode(secret) : secret;
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(time / 1000 / step)));
  const hmac = createHmac(algorithm, key).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits;
  return String(code).padStart(digits, "0");
}
