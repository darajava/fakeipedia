import { BillingError } from "./billing/config";

export function readPublicHandle(value: unknown): string | null {
  if (typeof value !== "string") throw new BillingError("Enter a name or handle, or leave it blank.");
  const handle = value.trim();
  if (handle.length > 50) throw new BillingError("Keep your name or handle within 50 characters.");
  if (/[\p{Cc}\p{Cf}]/u.test(handle)) throw new BillingError("Use a single line without invisible control characters.");
  return handle || null;
}
