import {
  DELEGATION_LIMITS,
  isReservedDelegationKey,
} from "../../src/shared/model/host-contracts/delegation";

const VALUE_LIMIT = 128;

/** Model settings admitted on a session command. Delegation links carry longer values. */
export function modelSettings(value: unknown): Record<string, string> {
  if (value == null) return {};
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid model settings");
  const entries = Object.entries(value);
  if (
    entries.length > 20 ||
    entries.some(
      ([key, setting]) =>
        !/^[a-zA-Z][a-zA-Z0-9]{0,63}$/.test(key) ||
        typeof setting !== "string" ||
        setting.length >
          (isReservedDelegationKey(key) ? DELEGATION_LIMITS.valueBytes : VALUE_LIMIT) ||
        setting.includes("\0"),
    )
  )
    throw new Error("Invalid model settings");
  return Object.fromEntries(entries) as Record<string, string>;
}
