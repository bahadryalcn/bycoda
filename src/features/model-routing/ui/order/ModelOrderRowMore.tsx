import { useId, useRef, useState } from "react";
import { useT } from "../../../../shared/i18n";
import type {
  ModelRoutingEntry,
  ModelRoutingEntryStatus,
} from "../../../../shared/model/host-contracts/model-routing";
import { Button } from "../../../../shared/ui/Button";
import { NumberField } from "../../../../shared/ui/NumberField";
import { Popover } from "../../../../shared/ui/Popover";
import { Select } from "../../../../shared/ui/Select";
import { Timestamp } from "../../../../shared/ui/Timestamp";
import { MoreHorizontal, Trash2 } from "../../../../shared/ui/icons";
import type { EntryAccount } from "./useEntryAccount";

/** The rarely changed settings of one order entry, behind a single overflow button. */
export function ModelOrderRowMore({
  entry,
  index,
  percent,
  account,
  status,
  onChange,
  onPercent,
  onRemove,
}: {
  entry: ModelRoutingEntry;
  index: number;
  percent: string;
  account: EntryAccount;
  status?: ModelRoutingEntryStatus;
  onChange: (entry: ModelRoutingEntry) => void;
  onPercent: (text: string) => void;
  onRemove: () => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const contentId = useId();
  const name = t("More for model {p0}", { p0: index + 1 });
  return (
    <>
      <Button
        ref={anchor}
        iconOnly
        variant="ghost"
        size="sm"
        label={name}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? contentId : undefined}
        onClick={() => setOpen((current) => !current)}
      >
        <MoreHorizontal className="icon-sm" />
      </Button>
      {open ? (
        <Popover
          id={contentId}
          anchor={anchor}
          width={260}
          kind="dialog"
          aria-label={name}
          tabIndex={-1}
          autoFocus
          flow="scroll"
          onDismiss={() => setOpen(false)}
          className="flex flex-col gap-3 p-3"
        >
          {account.supported ? (
            <Select
              label={t("Account")}
              value={account.id}
              options={[
                ...(!account.account
                  ? [{ value: account.id, label: t("Unavailable account"), disabled: true }]
                  : []),
                ...account.accounts.map((candidate) => ({
                  value: candidate.id,
                  label: candidate.label,
                })),
              ]}
              onValueChange={(providerAccountId) => onChange({ ...entry, providerAccountId })}
            />
          ) : null}
          <NumberField
            label={t("Keep % for my own use")}
            min={0}
            max={100}
            step={1}
            value={percent}
            onChange={(event) => onPercent(event.currentTarget.value)}
          />
          <Select
            label={t("If the limit is unknown")}
            value={entry.unknownLimit}
            options={[
              { value: "use", label: t("Use") },
              { value: "skip", label: t("Skip") },
            ]}
            onValueChange={(value) =>
              onChange({ ...entry, unknownLimit: value === "skip" ? "skip" : "use" })
            }
          />
          {status?.resetsAt != null ? (
            <Timestamp value={status.resetsAt} prefix={t("Resets")} size="caption" />
          ) : null}
          <Button
            variant="ghost"
            tone="danger"
            size="sm"
            startIcon={<Trash2 className="icon-sm" />}
            onClick={() => {
              setOpen(false);
              onRemove();
            }}
          >
            {t("Remove model {p0}", { p0: index + 1 })}
          </Button>
        </Popover>
      ) : null}
    </>
  );
}
