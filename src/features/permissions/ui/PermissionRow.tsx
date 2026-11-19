import { PermissionStatusBadge } from "./PermissionStatusBadge";
import { useState } from "react";
import { t } from "../../../shared/i18n";
import { Badge } from "../../../shared/ui/Badge";
import { Button } from "../../../shared/ui/Button";
import { Row } from "../../../shared/ui/settings";
import {
  requestSystemPermission,
  type PermissionId,
  type PermissionState,
} from "../../../platform/tauri/systemPermissions";
import { usePermissionStatus } from "../hooks/usePermissionStatus";
import {
  permissionBadge,
  permissionInfo,
  permissionNeedsRestart,
  permissionReady,
} from "../model/permissions";
import { PermissionRestartButton } from "./PermissionRestartButton";
import { PermissionSetupSheet } from "./PermissionSetupSheet";
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
}: {
  id: PermissionId;
  helperState?: PermissionState;
}) {
  const {
    entries: [entry],
    loading,
    failed,
    refresh,
  } = usePermissionStatus([id]);
  const [setup, setSetup] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const info = permissionInfo(id);
  const ready = permissionReady(entry.state);
  const restart = !failed && permissionNeedsRestart(entry);

  async function allow() {
    if (requesting) return;
    setRequesting(true);
    try {
      const next = await requestSystemPermission(id);
      if (!permissionReady(next.state)) setSetup(true);
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
            <Badge size="xs" tone="warning">
              {t("Status unavailable")}
            </Badge>
          ) : (
            <PermissionStatusBadge state={entry.state} restart={restart} animate />
          )}
          {helperState && (
            <Badge size="xs" tone={permissionBadge(helperState).tone}>
              {t("Helper: {p0}", { p0: permissionBadge(helperState).label })}
            </Badge>
          )}
        </span>
        {!ready && (
          <span className={styles.actions}>
            {failed && (
              <Button loading={loading} onClick={() => void refresh()}>
                {t("Check again")}
              </Button>
            )}
            {restart && <PermissionRestartButton />}
            {!failed && !restart && entry.canRequest && (
              <Button loading={requesting} disabled={requesting} onClick={() => void allow()}>
                {t("Allow")}
              </Button>
            )}
            {!failed && !restart && !entry.canRequest && (
              <Button onClick={() => setSetup(true)}>{t("Review access")}</Button>
            )}
          </span>
        )}
      </Row>
      {setup && <PermissionSetupSheet id={id} onClose={() => setSetup(false)} />}
    </>
  );
}
