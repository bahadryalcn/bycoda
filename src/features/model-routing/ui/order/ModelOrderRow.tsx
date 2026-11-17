import { useFormat, useT } from "../../../../shared/i18n";
import type {
  ModelRoutingEntry,
  ModelRoutingEntryStatus,
} from "../../../../shared/model/host-contracts/model-routing";
import { Badge } from "../../../../shared/ui/Badge";
import { Button } from "../../../../shared/ui/Button";
import { Checkbox } from "../../../../shared/ui/Checkbox";
import { InlineMessage } from "../../../../shared/ui/InlineError";
import { surfaceAttributes } from "../../../../shared/ui/Surface";
import { Text } from "../../../../shared/ui/Text";
import { OverflowTooltip } from "../../../../shared/ui/Tooltip";
import { GripVertical } from "../../../../shared/ui/icons";
import { REMOTE_PROVIDERS, isRemoteProvider } from "../../../connections/public/protocol";
import { ModelPicker } from "../../../sessions/public/ModelPicker";
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
  status,
  statusLoading,
  statusError = false,
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
  status?: ModelRoutingEntryStatus;
  statusLoading: boolean;
  statusError?: boolean;
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
        "reorder-item flex flex-wrap items-center gap-x-2 gap-y-1 px-4 py-2",
      )}
      data-entry-id={entry.id}
      data-dragging={sortable?.draggingId === entry.id ? "" : undefined}
      aria-label={t("Model {p0}", { p0: index + 1 })}
    >
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
      <div className="min-w-48 flex-1">
        <ModelPicker
          harness={entry.harness}
          model={entry.model}
          values={entrySettings(entry.modelSettings)}
          allowedHarnesses={REMOTE_PROVIDERS}
          presentation="field"
          showExtras
          hideAgentSettings
          accountId={entry.providerAccountId}
          onChange={(harness, model, accountId) => {
            if (!isRemoteProvider(harness)) return;
            onChange({
              ...entry,
              harness,
              model,
              providerAccountId:
                harness === "claude" || harness === "codex"
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
      <div className="flex w-16 shrink-0">
        <ModelProfileBadge harness={entry.harness} model={entry.model} />
      </div>
      {/* Fixed columns keep the pickers, tags and quota aligned across rows. */}
      <div className="flex w-56 shrink-0 items-center justify-end gap-2">
        {next ? (
          <Badge size="xs" tone="success" className="shrink-0">
            {t("Next")}
          </Badge>
        ) : null}
        {status?.skip ? (
          <OverflowTooltip label={t(skipLabels[status.skip])}>
            <Badge size="xs" tone="warning" truncate className="max-w-36">
              {t(skipLabels[status.skip])}
            </Badge>
          </OverflowTooltip>
        ) : null}
        <Text size="caption" tone="secondary" className="whitespace-nowrap">
          {left}
        </Text>
      </div>
      <ModelOrderRowMore
        entry={entry}
        index={index}
        percent={percent}
        account={account}
        status={status}
        onChange={onChange}
        onPercent={onPercent}
        onRemove={onRemove}
      />
      {invalidMessage ? (
        <InlineMessage tone="warning" className="w-full ps-6">
          {invalidMessage}
        </InlineMessage>
      ) : null}
    </div>
  );
}
