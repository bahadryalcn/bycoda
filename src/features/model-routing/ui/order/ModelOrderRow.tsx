import type { ReactNode } from "react";
import { useFormat, useT } from "../../../../shared/i18n";
import type {
  ModelRoutingEntry,
  ModelRoutingEntryStatus,
} from "../../../../shared/model/host-contracts/model-routing";
import { Button } from "../../../../shared/ui/Button";
import { Checkbox } from "../../../../shared/ui/Checkbox";
import { InlineMessage } from "../../../../shared/ui/InlineError";
import { surfaceAttributes } from "../../../../shared/ui/Surface";
import { Text } from "../../../../shared/ui/Text";
import { NumberField } from "../../../../shared/ui/NumberField";
import { Switch } from "../../../../shared/ui/Switch";
import { ArrowRight, GripVertical, Trash2, TriangleAlert } from "../../../../shared/ui/icons";
import { REMOTE_PROVIDERS, isRemoteProvider } from "../../../connections/public/protocol";
import { ModelPicker } from "../../../sessions/public/ModelPicker";
import { supportsProviderAccounts } from "../../../providers/public/providerAccounts";
import { defaultModelSettings, resolveModel } from "../../../sessions/public/models";
import { entrySettings, percentDraft } from "../../model/modelRoutingDraft";
import { PLAN_QUOTA_PROVIDERS } from "./ModelOrderLimits";
import type { useAnimatedReorder } from "../../../../shared/hooks/useAnimatedReorder";
import { ModelProfileBadge } from "./ModelProfileBadge";
import { useQuotaLabel } from "./useQuotaLabel";

/**
 * Column template shared by the order rows and their header so the list reads as a table:
 * lead (select, grip, number), model, profile, keep free, skip if unknown, usage, remove.
 * Below 58rem the settings wrap to a second line with their own visible labels, and the header
 * shows only the lead and model.
 */
const ORDER_COLUMNS =
  "grid-cols-[5rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-4 @min-[58rem]/model-order:grid-cols-[5rem_minmax(0,1fr)_4.5rem_5.5rem_6.5rem_10rem_2rem]";
export const ORDER_GRID = `grid ${ORDER_COLUMNS}`;
/** Inline labels for rows below 58rem, where the columns have no titles; wider, the header names them. */
const NARROW_LABEL = "@min-[58rem]/model-order:sr-only";
const NARROW_ONLY = "@min-[58rem]/model-order:hidden";

/**
 * The column titles above the rows; `selectAll` is the lead cell's checkbox. Without one (the By
 * account view, where each account header selects its rows) the header is shown only when wide.
 */
export function ModelOrderHeader({ selectAll }: { selectAll?: ReactNode }) {
  const t = useT();
  const wide = "hidden @min-[58rem]/model-order:block";
  return (
    <div
      className={`${selectAll ? "grid" : "hidden @min-[58rem]/model-order:grid"} ${ORDER_COLUMNS} pt-2 pb-1`}
    >
      <div className="flex items-center">{selectAll}</div>
      {[
        [t("Model"), ""],
        [t("Profile"), wide],
        [t("Keep free"), wide],
        [t("Skip if unknown"), wide],
        [t("Usage"), `${wide} text-end`],
      ].map(([label, className]) => (
        <Text key={label} size="caption" tone="secondary" className={className}>
          {label}
        </Text>
      ))}
    </div>
  );
}

/** Why an entry is skipped; `t()` takes literals only, so each label is translated where it is named. */
function skipLabel(skip: NonNullable<ModelRoutingEntryStatus["skip"]>, t: ReturnType<typeof useT>) {
  switch (skip) {
    case "unavailable":
      return t("Model unavailable or disabled");
    case "signedOut":
      return t("Account signed out");
    case "belowLimit":
      return t("Below the reserved limit");
    case "unknownLimit":
      return t("Unknown limit: skipped");
    case "missingCapability":
      return t("Host capability unavailable");
    case "otherScope":
      return t("Account is for other work");
  }
}

/**
 * One line per order entry with its settings in view; the account is chosen in the model
 * picker. Reordering is the grip (drag or Alt+Up/Down). Narrow lists move the settings to a
 * second line under the model.
 */
export function ModelOrderRow({
  entry,
  index,
  count,
  percent,
  providerPercent,
  status,
  statusLoading,
  statusError = false,
  accountQuota,
  next = false,
  sortable,
  selected = false,
  onSelect,
  invalidMessage,
  onChange,
  onPercent,
  onRemove,
}: {
  entry: ModelRoutingEntry;
  /** Position in the list it sits in; this is the real priority, shown as the number. */
  index: number;
  count: number;
  percent: string;
  /** The provider default "keep free" percent as typed; "" when none. */
  providerPercent: string;
  status?: ModelRoutingEntryStatus;
  statusLoading: boolean;
  statusError?: boolean;
  /** Quota already shown in this row's account header. */
  accountQuota?: string;
  /** New work starts on this model now. */
  next?: boolean;
  /** Drag and keyboard reordering; without it the row has no grip (grouped views). */
  sortable?: ReturnType<typeof useAnimatedReorder<string>>;
  selected?: boolean;
  /** Adds the selection checkbox. */
  onSelect?: (selected: boolean) => void;
  /** The Host refused this row; shown under it in warning tone. */
  invalidMessage?: string;
  onChange: (entry: ModelRoutingEntry) => void;
  onPercent: (text: string) => void;
  onRemove: () => void;
}) {
  const t = useT();
  const quotaReadable = PLAN_QUOTA_PROVIDERS.includes(entry.harness);
  const format = useFormat();
  const quotaLabel = useQuotaLabel();
  const left = quotaLabel(status, statusLoading, statusError);
  return (
    <div
      ref={(node) => sortable?.setItemRef(entry.id, node)}
      {...surfaceAttributes(
        invalidMessage ? { tone: "warning" } : {},
        `reorder-item ${ORDER_GRID} py-1.5`,
      )}
      data-entry-id={entry.id}
      data-dragging={sortable?.draggingId === entry.id ? "" : undefined}
      aria-label={t("Position {p0}", { p0: index + 1 })}
    >
      <div className="flex items-center gap-2">
        {onSelect ? (
          <Checkbox
            checked={selected}
            aria-label={t("Select model {p0}", { p0: index + 1 })}
            onChange={(event) => onSelect(event.currentTarget.checked)}
          />
        ) : null}
        {sortable ? (
          <Button
            iconOnly
            variant="ghost"
            size="sm"
            label={t("Reorder model {p0}", { p0: index + 1 })}
            tooltip={t("Drag to reorder")}
            shortcut="Alt+↑ / Alt+↓"
            disabled={count < 2}
            disabledReason={t("Add another model to reorder.")}
            onPointerDown={(event) => sortable.onItemPointerDown(entry.id, event)}
            onKeyDown={(event) => sortable.onItemKeyDown(entry.id, event)}
          >
            <GripVertical className="icon-sm" />
          </Button>
        ) : null}
        <Text size="secondary" tone="secondary" aria-hidden="true" className="w-5 text-center">
          {format.formatNumber(index + 1)}
        </Text>
      </div>
      <div className="col-start-2 col-end-3 row-start-1 min-w-0">
        <ModelPicker
          harness={entry.harness}
          model={entry.model}
          values={entrySettings(entry.modelSettings)}
          allowedHarnesses={REMOTE_PROVIDERS}
          presentation="field"
          showExtras
          hideAgentSettings
          accountChoices
          accountId={entry.providerAccountId}
          onChange={(harness, model, accountId) => {
            if (!isRemoteProvider(harness)) return;
            onChange({
              ...entry,
              harness,
              model,
              providerAccountId: supportsProviderAccounts(harness)
                ? (accountId ?? (harness === entry.harness ? entry.providerAccountId : undefined))
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
      {/* Below 58rem these settings wrap under the model; wider, each takes its own column. */}
      <div className="col-start-2 col-end-4 row-start-2 flex flex-wrap items-center gap-3 @min-[58rem]/model-order:contents">
        <div className="flex @min-[58rem]/model-order:col-start-3 @min-[58rem]/model-order:row-start-1">
          <ModelProfileBadge harness={entry.harness} model={entry.model} />
        </div>
        {quotaReadable ? (
          <>
            <div className="flex items-center gap-2 @min-[58rem]/model-order:col-start-4 @min-[58rem]/model-order:row-start-1">
              <Text size="caption" tone="secondary" aria-hidden="true" className={NARROW_ONLY}>
                {t("Keep free")}
              </Text>
              <div className="w-20">
                <NumberField
                  label={t("Keep % for my own use")}
                  hideLabel
                  fieldSize="sm"
                  steppers={false}
                  min={0}
                  max={100}
                  step={1}
                  inputMode="numeric"
                  placeholder={providerPercent.trim() ? providerPercent : "0"}
                  endAdornment={
                    <Text size="caption" tone="secondary" aria-hidden="true">
                      %
                    </Text>
                  }
                  value={percent}
                  onChange={(event) => onPercent(percentDraft(event.currentTarget.value, percent))}
                />
              </div>
            </div>
            {/* A switch, so the row's only checkbox stays the selection; its label shows when the column has no title. */}
            <div className="flex @min-[58rem]/model-order:col-start-5 @min-[58rem]/model-order:row-start-1">
              <Switch
                label={<span className={NARROW_LABEL}>{t("Skip if limit unknown")}</span>}
                labelText={{ size: "caption", tone: "secondary" }}
                aria-label={t("Skip if limit unknown")}
                checked={entry.unknownLimit === "skip"}
                onCheckedChange={(on) => onChange({ ...entry, unknownLimit: on ? "skip" : "use" })}
              />
            </div>
          </>
        ) : (
          // No readable plan quota: the cells stay empty so the columns keep their alignment.
          <>
            <div className="hidden @min-[58rem]/model-order:col-start-4 @min-[58rem]/model-order:row-start-1 @min-[58rem]/model-order:block" />
            <div className="hidden @min-[58rem]/model-order:col-start-5 @min-[58rem]/model-order:row-start-1 @min-[58rem]/model-order:block" />
          </>
        )}
        <div className="flex max-w-full flex-wrap items-center gap-x-2 gap-y-1 @min-[58rem]/model-order:col-start-6 @min-[58rem]/model-order:row-start-1 @min-[58rem]/model-order:justify-end">
          {next ? (
            <Text size="caption" tone="accent" className="inline-flex items-center gap-1">
              <ArrowRight className="icon-sm" aria-hidden />
              {t("Next")}
            </Text>
          ) : null}
          {status?.skip ? (
            <Text size="caption" tone="warning" className="inline-flex items-center gap-1">
              <TriangleAlert className="icon-sm shrink-0" aria-hidden />
              {skipLabel(status.skip, t)}
            </Text>
          ) : null}
          {left !== accountQuota ? (
            <Text size="caption" tone="secondary" className="break-words">
              {left}
            </Text>
          ) : null}
        </div>
      </div>
      <div className="col-start-3 row-start-1 @min-[58rem]/model-order:col-start-7">
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
      {invalidMessage ? (
        <div className="col-span-full ps-6">
          <InlineMessage tone="warning">{invalidMessage}</InlineMessage>
        </div>
      ) : null}
    </div>
  );
}
