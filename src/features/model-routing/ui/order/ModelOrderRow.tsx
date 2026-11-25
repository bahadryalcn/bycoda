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
import { InfoTooltip } from "../../../../shared/ui/InfoPopover";
import { ArrowRight, GripVertical, TriangleAlert } from "../../../../shared/ui/icons";
import { REMOTE_PROVIDERS, isRemoteProvider } from "../../../connections/public/protocol";
import { ModelPicker } from "../../../sessions/public/ModelPicker";
import { supportsProviderAccounts } from "../../../providers/public/providerAccounts";
import { defaultModelSettings, resolveModel } from "../../../sessions/public/models";
import { entrySettings } from "../../model/modelRoutingDraft";
import type { useAnimatedReorder } from "../../../../shared/hooks/useAnimatedReorder";
import { ModelOrderRowMore } from "./ModelOrderRowMore";
import { ModelProfileBadge } from "./ModelProfileBadge";
import { useEntryAccount } from "./useEntryAccount";
import { useQuotaLabel } from "./useQuotaLabel";

const skipLabels = {
  unavailable: "Model unavailable or disabled",
  signedOut: "Account signed out",
  belowLimit: "Below the reserved limit",
  unknownLimit: "Unknown limit: skipped",
  missingCapability: "Host capability unavailable",
  otherScope: "Account is for other work",
};

/** One compact line per order entry; reordering is the grip (drag or Alt+Up/Down). */
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
  const format = useFormat();
  const account = useEntryAccount(entry);
  const quotaLabel = useQuotaLabel();
  const left = quotaLabel(status, statusLoading, statusError);
  return (
    <div
      ref={(node) => sortable?.setItemRef(entry.id, node)}
      {...surfaceAttributes(
        invalidMessage ? { tone: "warning" } : {},
        "reorder-item grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-x-2 gap-y-1 px-4 py-2 @min-[40rem]/model-order:grid-cols-[auto_minmax(0,1fr)_auto_auto_auto]",
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
            onPointerDown={(event) => sortable.onItemPointerDown(entry.id, event)}
            onKeyDown={(event) => sortable.onItemKeyDown(entry.id, event)}
          >
            <GripVertical className="icon-sm" />
          </Button>
        ) : null}
        <Text size="secondary" tone="secondary" aria-hidden="true" className="w-4 text-center">
          {format.formatNumber(index + 1)}
        </Text>
      </div>
      <div className="col-start-2 col-end-4 row-start-1 min-w-0 @min-[40rem]/model-order:col-end-3">
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
      <div className="col-start-3 row-start-2 flex justify-end @min-[40rem]/model-order:row-start-1 @min-[40rem]/model-order:w-16 @min-[40rem]/model-order:justify-start">
        <ModelProfileBadge harness={entry.harness} model={entry.model} />
      </div>
      {/* Align the secondary line with the model field when it can't sit beside it. */}
      <div className="col-start-2 col-end-3 row-start-2 flex max-w-full flex-wrap items-center gap-x-2 gap-y-1 @min-[40rem]/model-order:col-start-4 @min-[40rem]/model-order:col-end-5 @min-[40rem]/model-order:row-start-1 @min-[40rem]/model-order:w-56 @min-[40rem]/model-order:justify-end">
        {next ? (
          <InfoTooltip
            label={t("Next model to be used")}
            icon={<ArrowRight className="icon-sm" aria-hidden />}
          >
            {t("Next model to be used")}
          </InfoTooltip>
        ) : null}
        {status?.skip ? (
          <InfoTooltip
            label={t(skipLabels[status.skip])}
            icon={<TriangleAlert className="icon-sm" aria-hidden />}
          >
            {t(skipLabels[status.skip])}
          </InfoTooltip>
        ) : null}
        {left !== accountQuota ? (
          <Text size="caption" tone="secondary" className="break-words">
            {left}
          </Text>
        ) : null}
      </div>
      <div className="col-start-4 row-start-1 @min-[40rem]/model-order:col-start-5">
        <ModelOrderRowMore
          entry={entry}
          index={index}
          percent={percent}
          providerPercent={providerPercent}
          account={account}
          onChange={onChange}
          onPercent={onPercent}
          onRemove={onRemove}
        />
      </div>
      {invalidMessage ? (
        <div className="col-span-full ps-6">
          <InlineMessage tone="warning">{invalidMessage}</InlineMessage>
        </div>
      ) : null}
    </div>
  );
}
