import { SocialPlatformError } from "../adapter";

/** Canonical X resource ID for target matching, suppression, and API paths. */
export function isXResourceId(value: unknown): value is string {
  return typeof value === "string" && /^[1-9]\d{0,18}$/.test(value);
}

export function xResourceId(value: unknown): string {
  if (!isXResourceId(value)) throw new SocialPlatformError("rejected");
  return value;
}
