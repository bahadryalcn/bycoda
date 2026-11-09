import {
  decodeDelegationParent,
  DELEGATION_PARENT_KEY,
} from "../../src/shared/model/host-contracts/delegation";

export function desktopDelegationParent(raw: unknown) {
  try {
    const settings = typeof raw === "string" ? JSON.parse(raw) : undefined;
    return decodeDelegationParent(settings?.[DELEGATION_PARENT_KEY]) ?? null;
  } catch {
    return null;
  }
}
