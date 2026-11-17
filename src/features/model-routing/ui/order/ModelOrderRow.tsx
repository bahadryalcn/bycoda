import { useFormat, useT } from "../../../../shared/i18n";
import type {
  ModelRoutingEntry,
  ModelRoutingEntryStatus,
} from "../../../../shared/model/host-contracts/model-routing";
import { Badge } from "../../../../shared/ui/Badge";
import { Button } from "../../../../shared/ui/Button";
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
  onChange,
  onPercent,
  onRemove,
}: {
  entry: ModelRoutingEntry;
  index: number;
  count: number;
  percent: string;
  status?: ModelRoutingEntryStatus;
  statusLoading: boolean;
  statusError?: boolean;
  /** New work starts on this model now. */
  next?: boolean;
  sortable: ReturnType<typeof useAnimatedReorder<string>>;
  onChange: (entry: ModelRoutingEntry) => void;
  onPercent: (text: string) => void;
  onRemove: () => void;
}) {
  const t = useT();
  const format = useFormat();
  const account = useEntryAccount(entry);
  const accountLabel = account.account?.label ?? t("Unavailable account");
  // The badge adds the scope; it is dropped when the account name already says it.
  const kindLabel = account.kind === "work" ? t("Work") : t("Personal");
  const left =
    status?.leftPercent == null
      ? t(
          statusLoading || status?.limitState === "reading"
            ? "Reading limit…"
            : statusError || status?.limitState === "unavailable"
              ? "Limit unavailable"
              : status?.limitState === "noQuota"
                ? "No plan quota"
                : "Limit unknown",
        )
      : t("{p0}% left", { p0: format.formatNumber(status.leftPercent) });
  return (
    <div
      ref={(node) => sortable.setItemRef(entry.id, node)}
      className="reorder-item flex flex-wrap items-center gap-x-2 gap-y-1 px-4 py-2"
      data-dragging={sortable.draggingId === entry.id ? "" : undefined}
      aria-label={t("Model {p0}", { p0: index + 1 })}
    >
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
      <div className="min-w-48 flex-1">
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
      {account.supported ? (
        <div className="flex w-40 shrink-0 items-center gap-1">
          <OverflowTooltip label={accountLabel}>
            <Text size="caption" tone="secondary" truncate>
              {accountLabel}
            </Text>
          </OverflowTooltip>
          {account.kind && kindLabel.toLowerCase() !== accountLabel.trim().toLowerCase() ? (
            <Badge
              size="xs"
              tone={account.kind === "work" ? "info" : "neutral"}
              className="shrink-0"
            >
              {kindLabel}
            </Badge>
          ) : null}
        </div>
      ) : (
        <div className="w-40 shrink-0" />
      )}
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
    </div>
  );
}
