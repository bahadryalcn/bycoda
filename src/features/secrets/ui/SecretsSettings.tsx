import { useMemo } from "react";
import { useT } from "../../../shared/i18n";
import { formatArchiveDate } from "../../../shared/i18n/format";
import { Button } from "../../../shared/ui/Button";
import { useConfirm } from "../../../shared/ui/ConfirmDialog";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { Text } from "../../../shared/ui/Text";
import {
  SettingsHostFailure,
  SettingsHostNotice,
  SettingsHostPicker,
  useSettingsHostScope,
  type SettingsHostScope,
} from "../../connections/public/settingsHosts";
import { Group, Row, SettingsFeedback } from "../../../shared/ui/settings";
import { useOwnerSecrets } from "../hooks/useOwnerSecrets";
import { secretsClient, type OwnerSecret } from "../model/secretsClient";
import { groupSecretsByProject } from "../model/secretsGroups";

/** Settings > Secrets: credentials agents asked for in chat, per project, removable here. */
export function SecretsSettings() {
  const t = useT();
  const scope = useSettingsHostScope();
  const hostId = scope.selected?.id;
  return (
    <div className="flex flex-col gap-4">
      <SettingsHostPicker scope={scope} />
      {/* Only a connected machine reaches the inventory; any other state is reported instead. */}
      {hostId ? (
        <OwnerSecretsInventory key={hostId} hostId={hostId} scope={scope} />
      ) : (
        <SettingsHostNotice scope={scope} lead={t("Could not load saved secrets.")} />
      )}
    </div>
  );
}

/** Host identity owns both inventory and any open removal confirmation. */
function OwnerSecretsInventory({ hostId, scope }: { hostId: string; scope: SettingsHostScope }) {
  const t = useT();
  const client = useMemo(() => secretsClient(hostId), [hostId]);
  const { state, reload } = useOwnerSecrets(client);
  const { confirm, dialog } = useConfirm();
  const groups = useMemo(
    () =>
      state.status === "ready" ? groupSecretsByProject(state.secrets, state.projectNames) : [],
    [state],
  );

  const remove = async (secret: OwnerSecret, project: string) => {
    const removed = await confirm({
      title: t("Remove secret?"),
      message: t(
        "{p0} is deleted from this device and agents in {p1} can no longer use it. Agents can ask for it again.",
        { p0: secret.name, p1: project },
      ),
      confirmLabel: t("Remove"),
      pendingLabel: t("Removing…"),
      onConfirm: async () => {
        try {
          await client.revoke(secret.secretRef);
        } catch {
          // The dialog stays open and shows this once; never render a credential RPC payload.
          throw new Error(t("Could not remove the secret."));
        }
      },
    });
    if (removed) reload();
  };

  if (state.status === "loading")
    return <SettingsFeedback state="loading">{t("Loading…")}</SettingsFeedback>;
  if (state.status === "error")
    return (
      <SettingsHostFailure
        scope={scope}
        message={[t("Could not load saved secrets."), state.reason].filter(Boolean).join(" ")}
        revoked={state.revoked}
        onRetry={reload}
      />
    );
  if (groups.length === 0)
    return (
      <EmptyState
        kind="empty"
        title={t("No saved secrets")}
        description={t(
          "Agents ask for credentials in the chat. Secrets you save there appear here.",
        )}
      />
    );
  return (
    <div className="flex flex-col gap-4">
      {groups.map((group) => (
        <Group key={group.projectId} title={group.title}>
          {group.secrets.map((secret) => (
            <Row
              key={secret.secretRef}
              label={secret.name}
              descriptionVisible
              description={[
                secret.purpose,
                secret.expiresAt === null
                  ? ""
                  : t("Expires {p0}", { p0: formatArchiveDate(secret.expiresAt) }),
              ]
                .filter(Boolean)
                .join(" · ")}
            >
              <Text size="caption" tone="muted">
                {t("Saved {p0}", { p0: formatArchiveDate(secret.createdAt) })}
              </Text>
              <Button
                size="sm"
                variant="ghost"
                tone="danger"
                onClick={() => remove(secret, group.title).catch(() => undefined)}
              >
                {t("Remove")}
              </Button>
            </Row>
          ))}
        </Group>
      ))}
      {dialog}
    </div>
  );
}
