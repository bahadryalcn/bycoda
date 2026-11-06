import { t } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Badge } from "../../../shared/ui/Badge";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { Progress } from "../../../shared/ui/Progress";
import { RefreshCw } from "../../../shared/ui/icons";
import {
  AdvancedSettings,
  Group,
  Row,
  SettingsFeedback,
} from "../../settings/public/settingsControls";
import type { WorkspaceStorageStatus } from "../model/contracts";
import { workspaceStorageSize } from "../model/workspacePresentation";
import styles from "./WorkspacePolicySettings.module.css";

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
  return (
    <div className={styles.storage}>
      <Group
        id="workspace-storage-status"
        title={t("Workspace storage")}
        layout="full"
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
        <dl className={styles.storageMetrics}>
          <div>
            <dt>
              {t("Directories")}
              {warning && (
                <Badge size="sm" tone="warning">
                  {t("Storage warning")}
                </Badge>
              )}
            </dt>
            <dd>
              {workspaceStorageSize(storage.materializedBytes)} /{" "}
              {workspaceStorageSize(storage.budgetBytes)}
            </dd>
            {storage.materializedBytes !== null && (
              <Progress
                aria-label={t("Directory budget")}
                value={storage.materializedBytes}
                max={storage.budgetBytes}
                compact
                tone={warning ? "warning" : "neutral"}
              />
            )}
          </div>
          <div>
            <dt>{t("Free space")}</dt>
            <dd>{workspaceStorageSize(storage.freeBytes)}</dd>
          </div>
        </dl>
        {storage.materialization !== "allowed" && (
          <SettingsFeedback state="warning">
            {storage.materialization === "paused"
              ? t("New workspaces are paused. Required free space: {p0}.", {
                  p0: workspaceStorageSize(storage.requiredFreeBytes),
                })
              : t(
                  "Storage availability is unknown. Refresh workspace status before creating a directory.",
                )}
          </SettingsFeedback>
        )}
        <AdvancedSettings title={t("Cache and recovery storage")} defaultOpen={false}>
          <Row label={t("Shared caches")}>
            <span className="tabular-nums">{workspaceStorageSize(storage.sharedCacheBytes)}</span>
          </Row>
          <Row label={t("Recovery objects")}>
            <span className="tabular-nums">{workspaceStorageSize(storage.recoveryBytes)}</span>
          </Row>
          <dl className={styles.rootPath}>
            <dt>{t("Storage folder")}</dt>
            <dd>{storage.root}</dd>
          </dl>
        </AdvancedSettings>
      </Group>
    </div>
  );
}
