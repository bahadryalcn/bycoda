import { useEffect, useState } from "react";
import { t } from "../../../../../shared/i18n";
import type { AssistantModelPoolRow } from "../../../../../shared/model/assistantModelPool";
import { ASSISTANT_MODEL_POOL_ROLES } from "../../../../../shared/model/assistantModelPool";
import { Button } from "../../../../../shared/ui/Button";
import { Checkbox } from "../../../../../shared/ui/Checkbox";
import { InlineError } from "../../../../../shared/ui/InlineError";
import { NumberField } from "../../../../../shared/ui/NumberField";
import { Select } from "../../../../../shared/ui/Select";
import { Timestamp } from "../../../../../shared/ui/Timestamp";
import { ArrowDown, ArrowUp, GripVertical, Trash2 } from "../../../../../shared/ui/icons";
import { isRemoteProvider, REMOTE_PROVIDERS } from "../../../../connections/public/protocol";
import {
  defaultProviderAccountId,
  providerAccounts,
  supportsProviderAccounts,
} from "../../../../providers/public/providerAccounts";
import { loadRateLimits, useCachedRateLimits } from "../../../../providers/public/rateLimitsCache";
import { ModelPicker } from "../../../../sessions/public/ModelPicker";
import { defaultModelSettings, resolveModel } from "../../../../sessions/public/models";
import {
  parseThreshold,
  POOL_ROLE_LABELS,
  tightestRemaining,
  toggleRole,
} from "../../../model/assistantModelPoolDraft";
import styles from "./modelPool.module.css";

type Sortable = {
  setItemRef: (id: string, node: HTMLElement | null) => void;
  onItemPointerDown: (id: string, event: React.PointerEvent) => unknown;
  onItemKeyDown: (id: string, event: React.KeyboardEvent) => unknown;
  draggingId: string | null;
};

/** Live remaining limit of the row's account, read-only: the tightest window and when it resets. */
function RowQuota({ row }: { row: AssistantModelPoolRow }) {
  const account = row.providerAccountId ?? defaultProviderAccountId(row.harness as "codex");
  const provider = row.harness === "claude" ? "claude" : "codex";
  const limits = useCachedRateLimits(provider, account);
  useEffect(() => {
    void loadRateLimits(provider, account);
  }, [provider, account]);
  const tight = tightestRemaining([limits.session, limits.weekly, limits.monthly]);
  if (!tight)
    return (
      <p className={styles.quota}>
        {limits.status === "fetching" || limits.status === "idle"
          ? t("Reading limit…")
          : t("Limit unknown")}
      </p>
    );
  return (
    <p className={styles.quota}>
      <strong>{t("{p0}% left", { p0: tight.percent })}</strong>
      {tight.resetsAt != null && (
        <Timestamp value={tight.resetsAt} prefix={t("Resets")} className={styles.reset} />
      )}
    </p>
  );
}

export function ModelPoolRow({
  row,
  index,
  count,
  problems,
  sortable,
  onChange,
  onMove,
  onRemove,
}: {
  row: AssistantModelPoolRow;
  index: number;
  count: number;
  problems: readonly string[];
  sortable: Sortable;
  onChange: (row: AssistantModelPoolRow) => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
}) {
  const number = index + 1;
  const accounts = supportsProviderAccounts(row.harness) ? providerAccounts(row.harness) : [];
  const accountId =
    row.providerAccountId ??
    (supportsProviderAccounts(row.harness) ? defaultProviderAccountId(row.harness) : "");
  // The draft text keeps "" and partial typing; the row holds the parsed integer.
  const [threshold, setThreshold] = useState(String(row.minRemainingPercent ?? ""));
  useEffect(() => {
    setThreshold((current) =>
      parseThreshold(current) === row.minRemainingPercent
        ? current
        : String(row.minRemainingPercent ?? ""),
    );
  }, [row.minRemainingPercent]);
  const dragging = sortable.draggingId === row.id;
  return (
    <fieldset
      ref={(node) => sortable.setItemRef(row.id, node)}
      className={`reorder-item ${styles.row}`}
      data-dragging={dragging ? "" : undefined}
      aria-label={t("Model {p0}", { p0: number })}
    >
      <div className={styles.head}>
        <Button
          iconOnly
          variant="ghost"
          type="button"
          label={t("Reorder model {p0}", { p0: number })}
          tooltip={t("Drag to reorder")}
          shortcut="Alt+↑ / Alt+↓"
          aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
          disabled={count < 2}
          onPointerDown={(event) => sortable.onItemPointerDown(row.id, event)}
          onKeyDown={(event) => sortable.onItemKeyDown(row.id, event)}
        >
          <GripVertical className="icon-sm" />
        </Button>
        <span className={styles.number} aria-hidden="true">
          {number}
        </span>
        <div className={styles.picker}>
          <ModelPicker
            harness={row.harness}
            model={row.model}
            values={row.modelSettings}
            allowedHarnesses={REMOTE_PROVIDERS}
            presentation="field"
            showExtras
            onChange={(harness, model) => {
              if (!isRemoteProvider(harness)) return;
              const unchanged = row.harness === harness && row.model === model;
              onChange({
                ...row,
                harness,
                model,
                providerAccountId: row.harness === harness ? row.providerAccountId : undefined,
                modelSettings: unchanged
                  ? row.modelSettings
                  : defaultModelSettings(resolveModel(harness, model)),
              });
            }}
            onSettingsChange={(modelSettings) =>
              onChange({ ...row, modelSettings: { ...row.modelSettings, ...modelSettings } })
            }
          />
        </div>
        <div className={styles.actions}>
          <Button
            iconOnly
            variant="ghost"
            type="button"
            label={t("Move model {p0} up", { p0: number })}
            disabled={index === 0}
            onClick={() => onMove(-1)}
          >
            <ArrowUp className="icon-sm" />
          </Button>
          <Button
            iconOnly
            variant="ghost"
            type="button"
            label={t("Move model {p0} down", { p0: number })}
            disabled={index === count - 1}
            onClick={() => onMove(1)}
          >
            <ArrowDown className="icon-sm" />
          </Button>
          <Button
            iconOnly
            variant="ghost"
            type="button"
            label={t("Remove model {p0}", { p0: number })}
            onClick={onRemove}
          >
            <Trash2 className="icon-sm" />
          </Button>
        </div>
      </div>
      <div className={styles.controls}>
        {accounts.length > 0 && (
          <Select
            label={t("Account")}
            value={accountId}
            options={accounts.map((account) => ({ value: account.id, label: account.label }))}
            onValueChange={(providerAccountId) => onChange({ ...row, providerAccountId })}
          />
        )}
        <NumberField
          label={t("Skip below % remaining")}
          min={0}
          max={100}
          step={1}
          inputMode="numeric"
          value={threshold}
          onChange={(event) => {
            const text = event.currentTarget.value;
            setThreshold(text);
            onChange({ ...row, minRemainingPercent: parseThreshold(text) });
          }}
        />
        <Select
          label={t("If limit unknown")}
          value={row.unknownLimit}
          options={[
            { value: "use", label: t("Use") },
            { value: "skip", label: t("Skip") },
          ]}
          onValueChange={(unknownLimit) =>
            onChange({ ...row, unknownLimit: unknownLimit === "skip" ? "skip" : "use" })
          }
        />
      </div>
      <div className={styles.footer}>
        <div className={styles.roles} role="group" aria-label={t("Roles served")}>
          {ASSISTANT_MODEL_POOL_ROLES.map((role) => (
            <Checkbox
              key={role}
              label={t(POOL_ROLE_LABELS[role])}
              checked={row.roles.includes(role)}
              onChange={(event) =>
                onChange({
                  ...row,
                  roles: toggleRole(row.roles, role, event.currentTarget.checked),
                })
              }
            />
          ))}
        </div>
        <RowQuota row={row} />
      </div>
      {problems.map((problem) => (
        <InlineError key={problem}>{t(problem)}</InlineError>
      ))}
    </fieldset>
  );
}
