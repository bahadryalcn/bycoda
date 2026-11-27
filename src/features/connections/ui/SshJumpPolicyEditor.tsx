import { Text } from "../../../shared/ui/Text";
import { Disclosure } from "../../../shared/ui/Disclosure";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { FieldGroup } from "../../../shared/ui/FieldGroup";
import { t } from "../../../shared/i18n";
import { useRef } from "react";
import { Button } from "../../../shared/ui/Button";
import { InlineError } from "../../../shared/ui/InlineError";
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
  const busyReason = disabled ? t("Wait for the current action to finish.") : undefined;
  const ids = useRef<number[]>([]).current;
  const nextId = useRef(0);
  while (ids.length < value.length) ids.push(nextId.current++);
  if (ids.length > value.length) ids.length = value.length;
  const update = (index: number, field: keyof SshJumpPolicyDraft, text: string) =>
    onChange(value.map((entry, i) => (i === index ? { ...entry, [field]: text } : entry)));
  const move = (index: number, offset: number) => {
    const next = [...value];
    [next[index], next[index + offset]] = [next[index + offset], next[index]];
    [ids[index], ids[index + offset]] = [ids[index + offset], ids[index]];
    onChange(next);
  };
  return (
    <section aria-label={t("Per-hop SSH policy")} className="flex min-w-0 flex-col gap-2">
      <Text as="p" tone="muted">
        {t("Strict host-key verification is always enabled for every hop.")}
      </Text>
      {value.map((hop, index) => (
        <FieldGroup
          key={ids[index]}
          disabled={disabled}
          gap="sm"
          legend={
            <>
              {t("Jump host")} {index + 1}
            </>
          }
        >
          <div className="flex min-w-0 items-end gap-1">
            <TextField
              fieldClassName="min-w-0 flex-1"
              label={t("Hostname")}
              aria-label={`${t("Jump host")} ${index + 1}: ${t("Hostname")}`}
              value={hop.host}
              maxLength={512}
              onChange={(event) => update(index, "host", event.target.value)}
            />
            <Button
              variant="ghost"
              iconOnly
              label={`${t("Move up")}: ${index + 1}`}
              disabled={disabled || index === 0}
              disabledReason={
                disabled
                  ? busyReason
                  : index === 0
                    ? t("The first jump host cannot move up.")
                    : undefined
              }
              onClick={() => move(index, -1)}
            >
              <ArrowUp className="icon-xs" />
            </Button>
            <Button
              variant="ghost"
              iconOnly
              label={`${t("Move down")}: ${index + 1}`}
              disabled={disabled || index === value.length - 1}
              disabledReason={
                disabled
                  ? busyReason
                  : index === value.length - 1
                    ? t("The last jump host cannot move down.")
                    : undefined
              }
              onClick={() => move(index, 1)}
            >
              <ArrowDown className="icon-xs" />
            </Button>
            <Button
              variant="ghost"
              iconOnly
              label={`${t("Remove jump host")}: ${index + 1}`}
              disabled={disabled}
              disabledReason={busyReason}
              onClick={() => {
                ids.splice(index, 1);
                onChange(value.filter((_, i) => i !== index));
              }}
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
          <Disclosure
            size="sm"
            summary={t("Hop identity and trust references")}
            summaryActions={
              <InfoPopover>
                {t(
                  "Use absolute paths or ~/ for hop file references. Relative paths are not supported.",
                )}{" "}
                {t(
                  "File references only. Empty identity uses the SSH agent or default identity; empty known-hosts reference uses the existing native trust store.",
                )}
              </InfoPopover>
            }
          >
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
                  ["certificateFile", t("Certificate file")],
                  ["knownHostsFile", t("Known hosts file")],
                ] as const
              ).map(([field, label]) => (
                <TextField
                  key={field}
                  label={label}
                  aria-label={`${t("Jump host")} ${index + 1}: ${label}`}
                  value={hop[field]}
                  maxLength={4096}
                  onChange={(event) => update(index, field, event.target.value)}
                />
              ))}
            </div>
          </Disclosure>
        </FieldGroup>
      ))}
      <Button
        variant="ghost"
        startIcon={<Plus className="icon-xs" />}
        disabled={disabled || value.length >= MAX_SSH_JUMP_HOSTS}
        disabledReason={
          disabled
            ? busyReason
            : value.length >= MAX_SSH_JUMP_HOSTS
              ? t("A connection can use at most {p0} jump hosts.", { p0: MAX_SSH_JUMP_HOSTS })
              : undefined
        }
        onClick={() => onChange([...value, emptySshJumpPolicyDraft()])}
      >
        {t("Add jump host")}
      </Button>
      {sshJumpPoliciesFromDrafts(value) === undefined ? (
        <InlineError live="polite">
          {t("Complete each hop with a valid host, port and file references.")}
        </InlineError>
      ) : null}
    </section>
  );
}
