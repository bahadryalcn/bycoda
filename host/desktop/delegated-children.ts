import {
  BACKGROUND_OWNER_KEY,
  decodeBackgroundOwner,
  decodeDelegationParent,
  DELEGATION_PARENT_KEY,
} from "../../src/shared/model/host-contracts/delegation";

export function desktopBackgroundOwner(raw: unknown) {
  try {
    const settings = typeof raw === "string" ? JSON.parse(raw) : undefined;
    return decodeBackgroundOwner(settings?.[BACKGROUND_OWNER_KEY]);
  } catch {
    return undefined;
  }
}

export function desktopDelegationParent(raw: unknown) {
  try {
    const settings = typeof raw === "string" ? JSON.parse(raw) : undefined;
    return decodeDelegationParent(settings?.[DELEGATION_PARENT_KEY]) ?? null;
  } catch {
    return null;
  }
}
