import { t } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { TextField } from "../../../shared/ui/TextField";
import { SshIdentityField } from "./SshIdentityField";
import { ArrowDown, ArrowUp, Plus, X } from "../../../shared/ui/icons";
import { MAX_SSH_JUMP_HOSTS } from "../model/sshEndpointReview";
import {
  emptySshJumpPolicyDraft,
  sshJumpPoliciesFromDrafts,
  type SshJumpPolicyDraft,
} from "../model/sshJumpPolicies";

/** Ordered, controlled drafts. Referenced files are never read by this editor. */
export function SshJumpPolicyEditor({
  value,
  onChange,
  disabled = false,
}: {
  value: readonly SshJumpPolicyDraft[];
  onChange: (value: SshJumpPolicyDraft[]) => void;
  disabled?: boolean;
}) {
  const update = (index: number, field: keyof SshJumpPolicyDraft, text: string) =>
    onChange(value.map((entry, i) => (i === index ? { ...entry, [field]: text } : entry)));
  const move = (index: number, offset: number) => {
    const next = [...value];
    [next[index], next[index + offset]] = [next[index + offset], next[index]];
    onChange(next);
  };
  return (
    <section aria-label={t("Per-hop SSH policy")} className="flex min-w-0 flex-col gap-2">
      <p className="text-xs text-(--ui-text-muted)">
        {t("Strict host-key verification is always enabled for every hop.")}
      </p>
      {value.map((hop, index) => (
        <fieldset key={index} disabled={disabled} className="min-w-0 border-0 p-0">
          <legend className="text-xs text-(--ui-text-muted)">
            {t("Jump host")} {index + 1}
          </legend>
          <div className="flex min-w-0 items-end gap-1">
            <TextField
              fieldClassName="min-w-0 flex-1"
              label={t("Host")}
              aria-label={`${t("Jump host")} ${index + 1}: ${t("Host")}`}
              value={hop.host}
              maxLength={512}
              onChange={(event) => update(index, "host", event.target.value)}
            />
            <Button
              variant="ghost"
              iconOnly
              label={`${t("Move up")}: ${index + 1}`}
              disabled={disabled || index === 0}
              onClick={() => move(index, -1)}
            >
              <ArrowUp className="icon-xs" />
            </Button>
            <Button
              variant="ghost"
              iconOnly
              label={`${t("Move down")}: ${index + 1}`}
              disabled={disabled || index === value.length - 1}
              onClick={() => move(index, 1)}
            >
              <ArrowDown className="icon-xs" />
            </Button>
            <Button
              variant="ghost"
              iconOnly
              label={`${t("Remove jump host")}: ${index + 1}`}
              disabled={disabled}
              onClick={() => onChange(value.filter((_, i) => i !== index))}
            >
              <X className="icon-xs" />
            </Button>
          </div>
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,6rem)] gap-2">
            <TextField
              label={t("User")}
              aria-label={`${t("Jump host")} ${index + 1}: ${t("User")}`}
              value={hop.user}
              maxLength={256}
              onChange={(event) => update(index, "user", event.target.value)}
            />
            <TextField
              label={t("Port")}
              aria-label={`${t("Jump host")} ${index + 1}: ${t("Port")}`}
              inputMode="numeric"
              value={hop.port}
              maxLength={5}
              onChange={(event) => update(index, "port", event.target.value)}
            />
          </div>
          <details className="text-xs text-(--ui-text-muted)">
            <summary className="cursor-pointer py-1">
              {t("Hop identity and trust references")}
            </summary>
            <div className="flex min-w-0 flex-col gap-2">
              <SshIdentityField
                label={`${t("Jump host")} ${index + 1}: ${t("Choose SSH key")}`}
                pathLabel={`${t("Jump host")} ${index + 1}: ${t("Identity file")}`}
                value={hop.identityFile}
                disabled={disabled}
                onChange={(value) => update(index, "identityFile", value)}
              />
              {(
                [
                  ["certificateFile", "Certificate file"],
                  ["knownHostsFile", "Known hosts file"],
                ] as const
              ).map(([field, label]) => (
                <TextField
                  key={field}
                  label={t(label)}
                  aria-label={`${t("Jump host")} ${index + 1}: ${t(label)}`}
                  value={hop[field]}
                  maxLength={4096}
                  onChange={(event) => update(index, field, event.target.value)}
                />
              ))}
              <p>
                {t(
                  "Use absolute paths or ~/ for hop file references. Relative paths are not supported.",
                )}
              </p>
              <p>
                {t(
                  "File references only. Empty identity uses the SSH agent or default identity; empty known-hosts reference uses the existing native trust store.",
                )}
              </p>
            </div>
          </details>
        </fieldset>
      ))}
      <Button
        variant="ghost"
        disabled={disabled || value.length >= MAX_SSH_JUMP_HOSTS}
        onClick={() => onChange([...value, emptySshJumpPolicyDraft()])}
      >
        <Plus className="icon-xs" />
        {t("Add jump host")}
      </Button>
      {sshJumpPoliciesFromDrafts(value) === undefined ? (
        <p role="status" className="text-xs text-(--ui-tone-danger-fg)">
          {t("Complete each hop with a valid host, port and file references.")}
        </p>
      ) : null}
    </section>
  );
}
