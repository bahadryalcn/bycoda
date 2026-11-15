import { PermissionStatusBadge } from "./PermissionStatusBadge";
import { useState } from "react";
import { t } from "../../../shared/i18n";
import { Badge } from "../../../shared/ui/Badge";
import { Button } from "../../../shared/ui/Button";
import { Row } from "../../settings/public/settingsControls";
import {
  requestSystemPermission,
  type PermissionId,
  type PermissionState,
} from "../../../platform/tauri/systemPermissions";
import { usePermissionStatus } from "../hooks/usePermissionStatus";
import { permissionBadge, permissionInfo, permissionReady } from "../model/permissions";
import { PermissionSetupSheet } from "./PermissionSetupSheet";
import styles from "./PermissionRow.module.css";

/**
 * One OS permission. A ready permission shows only its badge. "Allow" shows
 * the OS prompt in place and opens the guide only when access is still
 * missing afterwards; "Review access" opens the guide, which launches the
 * settings pane and watches for the grant. A failed status read offers only "Check again".
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
            <PermissionStatusBadge state={entry.state} animate />
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
            {!failed && entry.canRequest && (
              <Button loading={requesting} disabled={requesting} onClick={() => void allow()}>
                {t("Allow")}
              </Button>
            )}
            {!failed && !entry.canRequest && (
              <Button onClick={() => setSetup(true)}>
                {entry.canOpenSettings ? t("Review access…") : t("Setup guide")}
              </Button>
            )}
          </span>
        )}
      </Row>
      {setup && <PermissionSetupSheet id={id} onClose={() => setSetup(false)} />}
    </>
  );
}
