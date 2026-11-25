import { PermissionStatusBadge } from "./PermissionStatusBadge";
import { useState } from "react";
import { t } from "../../../shared/i18n";
import { Badge } from "../../../shared/ui/Badge";
import { Button } from "../../../shared/ui/Button";
import { InfoTooltip } from "../../../shared/ui/InfoPopover";
import { TriangleAlert } from "../../../shared/ui/icons";
import { Row } from "../../../shared/ui/settings";
import {
  requestSystemPermission,
  type PermissionId,
  type PermissionState,
} from "../../../platform/tauri/systemPermissions";
import { usePermissionStatus } from "../hooks/usePermissionStatus";
import {
  permissionBadge,
  permissionCanAddAppInSettings,
  permissionInfo,
  permissionNeedsRestart,
  permissionReady,
} from "../model/permissions";
import { PermissionRestartButton } from "./PermissionRestartButton";
import { PermissionSetupDialog } from "./PermissionSetupDialog";
import styles from "./PermissionRow.module.css";

/**
 * One OS permission. A ready permission shows only its badge. "Allow" shows
 * the OS prompt in place and opens the guide only when access is still
 * missing afterwards; "Review access" opens the guide, which launches the
 * settings pane and watches for the grant. Access switched on in the OS that
 * applies only after a restart offers "Restart now". A failed status read
 * offers only "Check again".
 */
export function PermissionRow({
  id,
  helperState,
  recheck = true,
}: {
  id: PermissionId;
  helperState?: PermissionState;
  /** `false` when the page offers one "Check again" for every row. */
  recheck?: boolean;
}) {
  const {
    report,
    entries: [entry],
    loading,
    failed,
    refresh,
  } = usePermissionStatus([id]);
  const [setup, setSetup] = useState(false);
  // The guide opened after the OS prompt failed to grant access: it leads with settings, not Allow.
  const [afterPrompt, setAfterPrompt] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const info = permissionInfo(id);
  const ready = permissionReady(entry.state);
  const restart = !failed && permissionNeedsRestart(entry);
  const promptInPlace =
    entry.canRequest &&
    !(entry.canOpenSettings && permissionCanAddAppInSettings(id, report?.platform));

  async function allow() {
    if (requesting) return;
    setRequesting(true);
    try {
      const next = await requestSystemPermission(id);
      if (!permissionReady(next.state)) {
        setAfterPrompt(true);
        setSetup(true);
      }
    } catch {
      setSetup(true);
    } finally {
      setRequesting(false);
      void refresh();
    }
  }

  return (
    <>
      <Row
        id={`permission-${id}`}
        label={info.label}
        description={t("Used by: {p0}", { p0: info.usedBy })}
      >
        <span className={styles.badges}>
          {failed ? (
            <InfoTooltip
              label={t("Status unavailable")}
              icon={<TriangleAlert className="icon-sm" aria-hidden />}
            >
              {t("Status unavailable")}
            </InfoTooltip>
          ) : (
            <PermissionStatusBadge state={entry.state} restart={restart} animate />
          )}
          {helperState && helperState !== entry.state && (
            <Badge size="xs" tone={permissionBadge(helperState).tone}>
              {t("Helper: {p0}", { p0: permissionBadge(helperState).label })}
            </Badge>
          )}
        </span>
        {!ready && (
          <span className={styles.actions}>
            {failed && recheck && (
              <Button loading={loading} onClick={() => void refresh()}>
                {t("Check again")}
              </Button>
            )}
            {restart && <PermissionRestartButton />}
            {!failed && !restart && promptInPlace && (
              <Button loading={requesting} onClick={() => void allow()}>
                {t("Allow")}
              </Button>
            )}
            {!failed && !restart && !promptInPlace && (
              <Button onClick={() => setSetup(true)}>{t("Review access")}</Button>
            )}
          </span>
        )}
      </Row>
      {setup && (
        <PermissionSetupDialog
          id={id}
          requested={afterPrompt}
          onClose={() => {
            setSetup(false);
            setAfterPrompt(false);
          }}
        />
      )}
    </>
  );
}
