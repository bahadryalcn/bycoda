import { Text } from "../../../../../shared/ui/Text";
import { t } from "../../../../../shared/i18n";
import { useAnimatedReorder } from "../../../../../shared/hooks/useAnimatedReorder";
import { moveItem } from "../../../../../shared/lib/reorder";
import {
  ASSISTANT_MODEL_POOL_MAX_ROWS,
  type AssistantModelPoolRow,
} from "../../../../../shared/model/assistantModelPool";
import { Button } from "../../../../../shared/ui/Button";
import { InlineError, InlineMessage } from "../../../../../shared/ui/InlineError";
import { LoadingText } from "../../../../../shared/ui/LoadingText";
import { Plus } from "../../../../../shared/ui/icons";
import { useModelSource } from "../../../../sessions/public/modelSource";
import { defaultModelSettings } from "../../../../sessions/public/models";
import type { assistantRequest } from "../../../model/assistantClient";
import {
  newPoolRowId,
  POOL_ROLE_LABELS,
  uncoveredRoles,
  validatePool,
} from "../../../model/assistantModelPoolDraft";
import { ModelPoolRow } from "./ModelPoolRow";
import { useModelPool, type PoolDraftState } from "./useModelPool";
import styles from "./modelPool.module.css";

/**
 * Ordered model pool: the models the Assistant may use, in priority order, with the roles each serves and
 * the remaining-limit threshold below which a model is skipped. It has its own version and Save; with
 * `saveRef` the dialog's Save applies it too.
 */
export function ModelPoolEditor({
  request,
  saveRef,
  onDraftStateChange,
}: {
  request: typeof assistantRequest;
  saveRef?: { current: (() => Promise<void>) | null };
  onDraftStateChange?: (state: PoolDraftState) => void;
}) {
  const source = useModelSource();
  const state = useModelPool(request, saveRef, onDraftStateChange);
  const { rows, change } = state;
  const issues = validatePool(rows);
  const sortable = useAnimatedReorder(
    rows.map((row) => row.id),
    (ids) => change(ids.map((id) => rows.find((row) => row.id === id)!)),
    "y",
  );

  function addRow() {
    const last = rows[rows.length - 1];
    const resolved = source.resolve(last?.harness ?? "codex", "");
    const row: AssistantModelPoolRow = {
      id: newPoolRowId(),
      harness: resolved.harness === "claude" ? "claude" : "codex",
      model: resolved.id,
      modelSettings: defaultModelSettings(resolved),
      runtimeMode: last?.runtimeMode ?? "supervised",
      maxRunMinutes: last?.maxRunMinutes ?? 60,
      roles: rows.some((candidate) => candidate.roles.includes("worker"))
        ? ["planning"]
        : ["worker"],
      unknownLimit: "use",
    };
    change([...rows, row]);
  }

  if (state.loading && !state.pool) return <LoadingText>{t("Loading models…")}</LoadingText>;
  if (!state.pool)
    return (
      <InlineError retry={{ onRetry: () => void state.reload(), label: t("Reload") }}>
        {state.loadError || t("The model list could not be read.")}
      </InlineError>
    );
  const fallback = uncoveredRoles(rows);
  return (
    <div className={styles.editor}>
      <Text as="p" size="caption" tone="secondary" leading="normal" className={styles.intro}>
        {t(
          "The assistant uses these models in order and skips a model whose remaining limit is below its threshold. Running work never switches model; new work moves to the next model.",
        )}
      </Text>
      {state.pool.derived && !state.dirty && (
        <InlineMessage tone="info">
          {t("Showing your current models. Save to keep this list.")}
        </InlineMessage>
      )}
      <div className={styles.list}>
        {rows.map((row, index) => (
          <ModelPoolRow
            key={row.id}
            row={row}
            index={index}
            count={rows.length}
            problems={issues.rows[row.id] ?? []}
            sortable={sortable}
            onChange={(next) =>
              change(rows.map((candidate) => (candidate.id === row.id ? next : candidate)))
            }
            onMove={(delta) => change(moveItem(rows, index, index + delta))}
            onRemove={() => change(rows.filter((candidate) => candidate.id !== row.id))}
          />
        ))}
      </div>
      {issues.pool.map((problem) => (
        <InlineError key={problem}>{t(problem)}</InlineError>
      ))}
      {fallback.length > 0 && issues.pool.length === 0 && (
        <InlineMessage tone="neutral">
          {t("No model is set for {p0}; the Worker models are used.", {
            p0: fallback.map((role) => t(POOL_ROLE_LABELS[role])).join(", "),
          })}
        </InlineMessage>
      )}
      {state.error && (
        <InlineError
          retry={
            state.conflict ? { onRetry: () => void state.reload(), label: t("Reload") } : undefined
          }
        >
          {state.error}
        </InlineError>
      )}
      <div className={styles.toolbar}>
        <Button
          type="button"
          size="sm"
          startIcon={<Plus className="icon-sm" />}
          disabled={rows.length >= ASSISTANT_MODEL_POOL_MAX_ROWS}
          onClick={addRow}
        >
          {t("Add model")}
        </Button>
        <div className={styles.saveBar}>
          <Button
            type="button"
            size="sm"
            disabled={!state.dirty || state.pending}
            onClick={state.revert}
          >
            {t("Revert")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="primary"
            loading={state.pending}
            loadingLabel={t("Saving…")}
            success={state.saved}
            successLabel={t("Models saved")}
            disabled={!state.dirty || state.conflict}
            onClick={() => void state.save()}
          >
            {t("Save models")}
          </Button>
        </div>
      </div>
    </div>
  );
}
