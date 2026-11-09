import { t } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Badge } from "../../../shared/ui/Badge";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { Progress } from "../../../shared/ui/Progress";
import { OverflowTooltip } from "../../../shared/ui/Tooltip";
import { RefreshCw } from "../../../shared/ui/icons";
import { Group, SettingsFeedback } from "../../settings/public/settingsControls";
import type { WorkspaceStorageStatus } from "../model/contracts";
import { workspaceStorageSize } from "../model/workspacePresentation";
import { DescriptionItem, DescriptionList } from "../../../shared/ui/DescriptionList";
import styles from "./WorkspacePolicySettings.module.css";

/** Unmeasured bytes read as "Not measured", never as a size or as zero. */
const measure = (bytes: number | null) =>
  bytes === null ? t("Not measured") : workspaceStorageSize(bytes);

export function WorkspaceStorageSummary({
  storage,
  busy,
  disabled,
  stale,
  onRefresh,
}: {
  storage: WorkspaceStorageStatus;
  busy: boolean;
  disabled: boolean;
  stale: boolean;
  onRefresh: () => void;
}) {
  const warning =
    storage.materializedBytes !== null &&
    storage.materializedBytes >= storage.budgetBytes * storage.warningRatio;
  // Older Hosts omit the field; treat that as no missing folders.
  const missing = storage.missingPaths?.length ?? 0;
  return (
    <div className={styles.storage}>
      <Group
        id="workspace-storage-status"
        title={t("Workspace storage")}
        layout="full"
        dependency={
          <OverflowTooltip label={storage.root} wide>
            <span className={styles.rootPath}>{storage.root}</span>
          </OverflowTooltip>
        }
        scope={
          busy
            ? t("Refreshing storage…")
            : stale
              ? t("Showing the last storage reading.")
              : undefined
        }
        info={
          <InfoPopover>
            <p>
              {t(
                "Read from the Host when this page last refreshed. Directory sizes can be unknown, and removing a directory may not free its full size.",
              )}
            </p>
          </InfoPopover>
        }
        action={
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            label={t("Refresh storage")}
            loading={busy}
            loadingLabel={t("Refreshing storage…")}
            disabled={disabled}
            onClick={onRefresh}
          >
            <RefreshCw className="icon-sm" />
          </Button>
        }
      >
        <div className={styles.storageBody}>
          <div className={styles.storageLine}>
            <span>
              <strong className={styles.used}>{measure(storage.materializedBytes)}</strong>{" "}
              <span className={styles.muted}>
                {"/ "}
                {t("{p0} budget", {
                  p0: workspaceStorageSize(storage.budgetBytes),
                })}
              </span>
            </span>
            {warning && (
              <Badge size="sm" tone="warning">
                {t("Storage warning")}
              </Badge>
            )}
            <span className={styles.free}>
              {t("Free on disk {p0}", { p0: measure(storage.freeBytes) })}
            </span>
          </div>
          <Progress
            aria-label={t("Directory budget")}
            value={storage.materializedBytes ?? 0}
            max={storage.budgetBytes}
            compact
            tone={warning ? "warning" : "neutral"}
          />
          <DescriptionList columns="auto" size="sm">
            <DescriptionItem term={t("Worktree folders")}>
              {measure(storage.materializedBytes)}
            </DescriptionItem>
            <DescriptionItem term={t("Recovery objects")}>
              {measure(storage.recoveryBytes)}
            </DescriptionItem>
          </DescriptionList>
        </div>
        {storage.materialization !== "allowed" && (
          <SettingsFeedback
            state="warning"
            action={
              <Button variant="ghost" size="sm" disabled={disabled} onClick={onRefresh}>
                {t("Refresh storage")}
              </Button>
            }
          >
            {storage.materialization === "paused"
              ? t("New workspaces are paused. Required free space: {p0}.", {
                  p0: workspaceStorageSize(storage.requiredFreeBytes),
                })
              : t(
                  "Storage could not be measured, so new worktrees are paused. Refresh to try again.",
                )}
          </SettingsFeedback>
        )}
        {missing > 0 && (
          <SettingsFeedback state="warning">
            {t(
              "Missing worktree folders: {p0}. They count as 0 bytes; remove their records with each row's Remove record action.",
              { p0: missing },
            )}
          </SettingsFeedback>
        )}
      </Group>
    </div>
  );
}
