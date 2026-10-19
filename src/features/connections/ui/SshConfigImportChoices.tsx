import { t } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { sshJumpChain } from "../model/sshEndpointReview";
import type { ServerRecord, SshEndpoint } from "../model/serverInventory";
type Preview = { hosts: { alias: string; endpoint: SshEndpoint; duplicate: boolean }[] };

/** Each choice names its exact saved record. Import never overwrites a duplicate. */
export function ConfigImportChoices({
  host,
  existing,
  busy,
  onSkip,
  onImport,
  onUse,
  onEdit,
}: {
  host: Preview["hosts"][number];
  existing: ServerRecord[];
  busy: boolean;
  onSkip: () => void;
  onImport: () => void;
  onUse?: (server: ServerRecord) => void;
  onEdit?: (server: ServerRecord) => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2 border-t border-stroke py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0 break-words text-xs">
          {host.alias} · {host.endpoint.user ? `${host.endpoint.user}@` : ""}
          {host.endpoint.host}:{host.endpoint.port}
        </span>
        <div className="flex gap-2">
          <Button variant="ghost" disabled={busy} onClick={onSkip}>
            {t("Skip")}
          </Button>
          {!existing.length && !host.duplicate ? (
            <Button loading={busy} onClick={onImport}>
              {t("Import")}
            </Button>
          ) : null}
        </div>
      </div>
      {host.endpoint.identityFile ? (
        <p className="break-all text-xs text-(--ui-text-muted)">
          {t("Identity file")}: {host.endpoint.identityFile}
        </p>
      ) : null}
      {host.endpoint.certificateFile ? (
        <p className="break-all text-xs text-(--ui-text-muted)">
          {t("Public SSH certificate file")}: {host.endpoint.certificateFile}
        </p>
      ) : null}
      {sshJumpChain(host.endpoint).length ? (
        <>
          <p className="break-all text-xs text-(--ui-text-muted)">
            {t("Jump chain")}: {sshJumpChain(host.endpoint).join(" → ")}
          </p>
          <JumpAuthenticationHelp />
        </>
      ) : null}
      {existing.length ? (
        <p className="text-xs text-(--ui-text-muted)">
          {t("This endpoint is already saved. Choose an existing connection.")}
        </p>
      ) : host.duplicate ? (
        <p className="text-xs text-(--ui-text-muted)">{t("Duplicate entry in this import.")}</p>
      ) : null}
      {existing.map((candidate) => (
        <div key={candidate.id} className="flex flex-wrap items-center justify-between gap-2">
          <span className="min-w-0 break-words text-xs">{candidate.name}</span>
          <div className="flex gap-2">
            {onUse ? (
              <Button disabled={busy} onClick={() => onUse(candidate)}>
                {t("Use existing")}
              </Button>
            ) : null}
            {onEdit ? (
              <Button variant="ghost" disabled={busy} onClick={() => onEdit(candidate)}>
                {t("Edit existing")}
              </Button>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

export function JumpAuthenticationHelp() {
  return (
    <details className="text-xs text-(--ui-text-muted)">
      <summary className="cursor-pointer">{t("Jump host authentication")}</summary>
      <p className="mbs-2 break-words">
        {t(
          "Each jump host uses its own identity and host-key verification. Configure per-hop SSH policies to choose a different key for each hop.",
        )}
      </p>
    </details>
  );
}
