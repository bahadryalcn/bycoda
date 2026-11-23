import { useId, useRef, useState } from "react";
import { useT } from "../../../../shared/i18n";
import type { ModelRoutingEntry } from "../../../../shared/model/host-contracts/model-routing";
import { Button } from "../../../../shared/ui/Button";
import { NumberField } from "../../../../shared/ui/NumberField";
import { Popover } from "../../../../shared/ui/Popover";
import { Select } from "../../../../shared/ui/Select";
import { MoreHorizontal, Trash2 } from "../../../../shared/ui/icons";
import type { EntryAccount } from "./useEntryAccount";

/** The rarely changed settings of one order entry, behind a single overflow button. */
export function ModelOrderRowMore({
  entry,
  index,
  percent,
  providerPercent,
  account,
  onChange,
  onPercent,
  onRemove,
}: {
  entry: ModelRoutingEntry;
  index: number;
  percent: string;
  /** The provider default "keep free" percent as typed; "" when none. */
  providerPercent: string;
  account: EntryAccount;
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
          variant="panel"
          className="flex flex-col gap-3"
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
            placeholder={
              providerPercent.trim() ? t("{p0} (provider)", { p0: providerPercent }) : "0"
            }
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
            {t("Remove")}
          </Button>
        </Popover>
      ) : null}
    </>
  );
}
