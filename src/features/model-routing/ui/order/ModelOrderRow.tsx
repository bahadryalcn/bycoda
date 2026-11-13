import { useSyncExternalStore, type ReactNode } from "react";
import { useFormat, useT } from "../../../../shared/i18n";
import type {
  ModelRoutingEntry,
  ModelRoutingEntryStatus,
} from "../../../../shared/model/host-contracts/model-routing";
import { Button } from "../../../../shared/ui/Button";
import { InlineMessage } from "../../../../shared/ui/InlineError";
import { NumberField } from "../../../../shared/ui/NumberField";
import { Select } from "../../../../shared/ui/Select";
import { Text } from "../../../../shared/ui/Text";
import { Timestamp } from "../../../../shared/ui/Timestamp";
import { ArrowDown, ArrowUp, GripVertical, Trash2 } from "../../../../shared/ui/icons";
import { REMOTE_PROVIDERS, isRemoteProvider } from "../../../connections/public/protocol";
import {
  defaultProviderAccountId,
  providerAccounts,
  subscribeProviderAccounts,
} from "../../../providers/public/providerAccounts";
import { ModelPicker } from "../../../sessions/public/ModelPicker";
import { defaultModelSettings, resolveModel } from "../../../sessions/public/models";
import { entrySettings } from "../../model/modelRoutingDraft";
import type { useAnimatedReorder } from "../../../../shared/hooks/useAnimatedReorder";

const skipLabels = {
  unavailable: "Model unavailable or disabled",
  signedOut: "Account signed out",
  belowLimit: "Below the reserved limit",
  unknownLimit: "Unknown limit: skipped",
  missingCapability: "Host capability unavailable",
};

export function ModelOrderRow({
  entry,
  index,
  count,
  percent,
  status,
  statusLoading,
  sortable,
  onChange,
  onPercent,
  onMove,
  onRemove,
}: {
  entry: ModelRoutingEntry;
  index: number;
  count: number;
  percent: string;
  status?: ModelRoutingEntryStatus;
  statusLoading: boolean;
  sortable: ReturnType<typeof useAnimatedReorder<string>>;
  onChange: (entry: ModelRoutingEntry) => void;
  onPercent: (text: string) => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
}) {
  const t = useT();
  const format = useFormat();
  const accountProvider =
    entry.harness === "claude" || entry.harness === "codex" ? entry.harness : undefined;
  const accountSnapshot = useSyncExternalStore(subscribeProviderAccounts, () =>
    JSON.stringify(accountProvider ? providerAccounts(accountProvider) : []),
  );
  const accounts: ReturnType<typeof providerAccounts> = JSON.parse(accountSnapshot);
  const accountId =
    entry.providerAccountId ?? (accountProvider ? defaultProviderAccountId(accountProvider) : "");
  const left =
    status?.leftPercent == null
      ? t(statusLoading ? "Reading limit…" : "Limit unknown")
      : t("{p0}% left", { p0: format.formatNumber(status.leftPercent) });
  return (
    <div
      ref={(node) => sortable.setItemRef(entry.id, node)}
      className="reorder-item flex flex-col gap-2 px-4 py-3"
      data-dragging={sortable.draggingId === entry.id ? "" : undefined}
      aria-label={t("Model {p0}", { p0: index + 1 })}
    >
      <div className="flex items-center gap-2">
        <Button
          iconOnly
          variant="ghost"
          size="sm"
          label={t("Reorder model {p0}", { p0: index + 1 })}
          tooltip={t("Drag to reorder")}
          shortcut="Alt+↑ / Alt+↓"
          disabled={count < 2}
          onPointerDown={(event) => sortable.onItemPointerDown(entry.id, event)}
          onKeyDown={(event) => sortable.onItemKeyDown(entry.id, event)}
        >
          <GripVertical className="icon-sm" />
        </Button>
        <Text size="secondary" tone="secondary" aria-hidden="true" className="w-4 text-center">
          {format.formatNumber(index + 1)}
        </Text>
        <div className="min-w-0 flex-1">
          <ModelPicker
            harness={entry.harness}
            model={entry.model}
            values={entrySettings(entry.modelSettings)}
            allowedHarnesses={REMOTE_PROVIDERS}
            presentation="field"
            showExtras
            accountId={entry.providerAccountId}
            onChange={(harness, model, accountId) => {
              if (!isRemoteProvider(harness)) return;
              onChange({
                ...entry,
                harness,
                model,
                providerAccountId:
                  harness === "claude" || harness === "codex"
                    ? (accountId ??
                      (harness === entry.harness ? entry.providerAccountId : undefined))
                    : undefined,
                modelSettings: entrySettings(
                  harness === entry.harness && model === entry.model
                    ? entry.modelSettings
                    : defaultModelSettings(resolveModel(harness, model)),
                ),
              });
            }}
            onSettingsChange={(settings) =>
              onChange({
                ...entry,
                modelSettings: entrySettings({ ...entry.modelSettings, ...settings }),
              })
            }
          />
        </div>
        <Text
          size="caption"
          tone={status?.skip ? "warning" : "secondary"}
          className="w-24 shrink-0 text-end whitespace-nowrap"
        >
          {left}
        </Text>
        <Button
          iconOnly
          variant="ghost"
          size="sm"
          label={t("Move model {p0} up", { p0: index + 1 })}
          disabled={index === 0}
          onClick={() => onMove(-1)}
        >
          <ArrowUp className="icon-sm" />
        </Button>
        <Button
          iconOnly
          variant="ghost"
          size="sm"
          label={t("Move model {p0} down", { p0: index + 1 })}
          disabled={index === count - 1}
          onClick={() => onMove(1)}
        >
          <ArrowDown className="icon-sm" />
        </Button>
        <Button
          iconOnly
          variant="ghost"
          size="sm"
          label={t("Remove model {p0}", { p0: index + 1 })}
          onClick={onRemove}
        >
          <Trash2 className="icon-sm" />
        </Button>
      </div>
      <div
        role="group"
        aria-label={t("Limits and account for model {p0}", { p0: index + 1 })}
        className="flex flex-wrap items-center gap-x-4 gap-y-2 ps-12"
      >
        {accountProvider && (
          <InlineField label={t("Account")}>
            <Select
              label={t("Account")}
              hideLabel
              fieldSize="sm"
              value={accountId}
              options={[
                ...(!accounts.some((account) => account.id === accountId)
                  ? [{ value: accountId, label: t("Unavailable account"), disabled: true }]
                  : []),
                ...accounts.map((account) => ({ value: account.id, label: account.label })),
              ]}
              onValueChange={(providerAccountId) => onChange({ ...entry, providerAccountId })}
            />
          </InlineField>
        )}
        <InlineField label={t("Keep % for my own use")}>
          <div className="w-28">
            <NumberField
              label={t("Keep % for my own use")}
              hideLabel
              min={0}
              max={100}
              step={1}
              value={percent}
              onChange={(event) => onPercent(event.currentTarget.value)}
            />
          </div>
        </InlineField>
        <InlineField label={t("If the limit is unknown")}>
          <Select
            label={t("If the limit is unknown")}
            hideLabel
            fieldSize="sm"
            value={entry.unknownLimit}
            options={[
              { value: "use", label: t("Use") },
              { value: "skip", label: t("Skip") },
            ]}
            onValueChange={(value) =>
              onChange({ ...entry, unknownLimit: value === "skip" ? "skip" : "use" })
            }
          />
        </InlineField>
        {status?.resetsAt != null && (
          <Timestamp value={status.resetsAt} prefix={t("Resets")} size="caption" />
        )}
      </div>
      {status?.skip && (
        <div className="ps-12">
          <InlineMessage tone="warning" live="off">
            {t(skipLabels[status.skip])}
          </InlineMessage>
        </div>
      )}
    </div>
  );
}

function InlineField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <Text size="caption" tone="secondary" aria-hidden="true" className="whitespace-nowrap">
        {label}
      </Text>
      {children}
    </div>
  );
}
