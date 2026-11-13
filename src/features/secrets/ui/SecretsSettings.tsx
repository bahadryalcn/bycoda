import { useMemo, useState } from "react";
import { useT } from "../../../shared/i18n";
import { formatArchiveDate } from "../../../shared/i18n/format";
import { Button } from "../../../shared/ui/Button";
import { useConfirm } from "../../../shared/ui/ConfirmDialog";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { useRemoteMachines } from "../../connections/public/connections";
import { isLocalSyncMachine } from "../../connections/public/localSync";
import { Group, Row, SettingsFeedback } from "../../settings/public/settingsControls";
import { useOwnerSecrets } from "../hooks/useOwnerSecrets";
import { secretsClient, type OwnerSecret } from "../model/secretsClient";
import { groupSecretsByProject } from "../model/secretsGroups";

/** Settings > Secrets: credentials agents asked for in chat, per project, removable here. */
export function SecretsSettings() {
  const t = useT();
  const { machines, loading, refresh } = useRemoteMachines();
  const hostId = machines.find(isLocalSyncMachine)?.id;
  if (!hostId)
    return loading ? (
      <SettingsFeedback state="loading">{t("Loading…")}</SettingsFeedback>
    ) : (
      <SettingsFeedback
        state="error"
        action={
          <Button size="sm" variant="ghost" onClick={refresh}>
            {t("Retry")}
          </Button>
        }
      >
        {t("Could not load saved secrets.")}
      </SettingsFeedback>
    );
  return <OwnerSecretsInventory key={hostId} hostId={hostId} />;
}

/** Host identity owns both inventory and any open removal confirmation. */
function OwnerSecretsInventory({ hostId }: { hostId: string }) {
  const t = useT();
  const client = useMemo(() => secretsClient(hostId), [hostId]);
  const { state, reload } = useOwnerSecrets(client);
  const { confirm, dialog } = useConfirm();
  const [failed, setFailed] = useState(false);
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
        setFailed(false);
        try {
          await client.revoke(secret.secretRef);
        } catch {
          setFailed(true);
          // Confirmation errors are visible; never render a credential RPC payload.
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
      <SettingsFeedback
        state="error"
        action={
          <Button size="sm" variant="ghost" onClick={reload}>
            {t("Retry")}
          </Button>
        }
      >
        {t("Could not load saved secrets.")}
      </SettingsFeedback>
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
      {failed ? (
        <SettingsFeedback state="error">{t("Could not remove the secret.")}</SettingsFeedback>
      ) : null}
      {groups.map((group) => (
        <Group key={group.projectId} title={group.title}>
          {group.secrets.map((secret) => (
            <Row
              key={secret.secretRef}
              label={secret.name}
              description={[
                secret.purpose,
                t("Saved {p0}", { p0: formatArchiveDate(secret.createdAt) }),
                secret.expiresAt === null
                  ? t("Never expires")
                  : t("Expires {p0}", { p0: formatArchiveDate(secret.expiresAt) }),
              ]
                .filter(Boolean)
                .join(" · ")}
            >
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
