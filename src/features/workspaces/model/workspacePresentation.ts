import { formatNumber, t } from "../../../shared/i18n";
import type { ManagedWorkspace, WorkspacePolicy } from "./contracts";

const GIB = 1_073_741_824;

export function workspaceStorageSize(bytes: number | null): string {
  return bytes === null
    ? t("Unknown")
    : `${formatNumber(bytes / GIB, { minimumFractionDigits: 1, maximumFractionDigits: 1, useGrouping: false })} GiB`;
}

/** The Host accepts only positive, safe-integer byte counts (host/workspaces/workspace-policy.ts). */
const positiveBytes = (value: number) =>
  Number.isFinite(value) && value > 0 && Number.isSafeInteger(value);

export type PolicyDiskErrors = { budget?: string; warning?: string; minimumFree?: string };

/** Mirrors the Host contract so Save is never offered for a value it will reject. */
export function workspacePolicyDiskErrors(disk: WorkspacePolicy["disk"]): PolicyDiskErrors {
  const errors: PolicyDiskErrors = {};
  if (!positiveBytes(disk.budgetBytes))
    errors.budget = t("Enter a directory budget greater than 0 GiB.");
  if (!Number.isFinite(disk.warningRatio) || disk.warningRatio <= 0 || disk.warningRatio > 1)
    errors.warning = t("Enter a warning from 1 to 100%.");
  if (!positiveBytes(disk.minimumFreeBytes))
    errors.minimumFree = t("Enter minimum free space greater than 0 GiB.");
  return errors;
}

export function lifecycleLabel(state: ManagedWorkspace["state"]) {
  return {
    active: t("Active"),
    idle: t("Idle"),
    finished: t("Finished"),
    merged: t("Merged"),
    abandoned: t("Closed"),
  }[state];
}
