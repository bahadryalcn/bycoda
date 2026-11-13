import { Text } from "../../../shared/ui/Text";
import { t } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { sshJumpChain } from "../model/sshEndpointReview";
import type { ServerRecord, SshEndpoint } from "../model/serverInventory";
type Preview = {
  hosts: { alias: string; endpoint: SshEndpoint; duplicate: boolean }[];
};

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
    <div
      {...surfaceAttributes({ frame: "stroke", edge: "top" }, "flex min-w-0 flex-col gap-2 py-2")}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Text tone="inherit" className="min-w-0 break-words">
          {host.alias} · {host.endpoint.user ? `${host.endpoint.user}@` : ""}
          {host.endpoint.host}:{host.endpoint.port}
        </Text>
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
        <Text wrap="anywhere" as="p" tone="muted">
          {t("Identity file")}: {host.endpoint.identityFile}
        </Text>
      ) : null}
      {host.endpoint.certificateFile ? (
        <Text wrap="anywhere" as="p" tone="muted">
          {t("Public SSH certificate file")}: {host.endpoint.certificateFile}
        </Text>
      ) : null}
      {sshJumpChain(host.endpoint).length ? (
        <>
          <Text wrap="anywhere" as="p" tone="muted">
            {t("Jump chain")}: {sshJumpChain(host.endpoint).join(" → ")}
          </Text>
          <JumpAuthenticationHelp />
        </>
      ) : null}
      {existing.length ? (
        <Text as="p" tone="muted">
          {t("This endpoint is already saved. Choose an existing connection.")}
        </Text>
      ) : host.duplicate ? (
        <Text as="p" tone="muted">
          {t("Duplicate entry in this import.")}
        </Text>
      ) : null}
      {existing.map((candidate) => (
        <div key={candidate.id} className="flex flex-wrap items-center justify-between gap-2">
          <Text tone="inherit" className="min-w-0 break-words">
            {candidate.name}
          </Text>
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
    <Text as="p" tone="muted" className="break-words">
      {t(
        "Each jump host uses its own identity and host-key verification. Configure per-hop SSH policies to choose a different key for each hop.",
      )}
    </Text>
  );
}
