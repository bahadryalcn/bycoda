import { t } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { InlineMessage } from "../../../shared/ui/InlineError";
import { Group } from "../../../shared/ui/settings";
import { usePermissionStatus } from "../hooks/usePermissionStatus";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";
import { linuxPermissionInstructions, PERMISSION_IDS, permissionInfo } from "../model/permissions";
import { PermissionRow } from "./PermissionRow";

export function PermissionsSettings() {
  const { report, failed, loading, refresh } = usePermissionStatus();
  // Capabilities this OS does not gate collapse into one line instead of rows
  // with nothing to do. Until the first read they stay rows, never hidden.
  const notRequired = PERMISSION_IDS.filter(
    (id) => report?.entries.find((entry) => entry.id === id)?.state === "not-required",
  );
  return (
    <div className="settings-topics">
      {/* The page applies to this computer only; one failed read is rechecked once for all rows. */}
      <Group
        title={t("This computer")}
        action={
          failed ? (
            <Button size="sm" loading={loading} onClick={() => void refresh()}>
              {t("Check again")}
            </Button>
          ) : undefined
        }
      >
        {PERMISSION_IDS.filter((id) => !notRequired.includes(id)).map((id) => (
          <PermissionRow key={id} id={id} recheck={false} />
        ))}
      </Group>
      {notRequired.length > 0 && (
        <InlineMessage>
          {t("This system does not ask for these permissions: {p0}", {
            p0: notRequired.map((id) => permissionInfo(id).label).join(", "),
          })}
        </InlineMessage>
      )}
      {report?.platform === "macos" && report.signing === "ad-hoc" && (
        <InlineMessage tone="warning">
          {t(
            "This build is not signed with a stable identity, so macOS forgets these permissions after each update.",
          )}
        </InlineMessage>
      )}
      {report?.platform === "windows" && (
        <InlineMessage>
          {report.elevated
            ? t("{p0} is running as administrator.", { p0: PRODUCT_IDENTITY.displayName })
            : t(
                "{p0} cannot control apps running as administrator. Run the target app without elevation.",
                { p0: PRODUCT_IDENTITY.displayName },
              )}
        </InlineMessage>
      )}
      {report?.platform === "linux" && (
        <InlineMessage>{linuxPermissionInstructions()}</InlineMessage>
      )}
    </div>
  );
}
