import { useState } from "react";
import { t, useLocale } from "../../../../shared/i18n";
import { Alert } from "../../../../shared/ui/Alert";
import { Button } from "../../../../shared/ui/Button";
import { useConfirm } from "../../../../shared/ui/ConfirmDialog";
import { EmptyState } from "../../../../shared/ui/EmptyState";
import { LoadingText } from "../../../../shared/ui/LoadingText";
import { Modal } from "../../../../shared/ui/Modal";
import { TextField } from "../../../../shared/ui/TextField";
import { Plus, Trash2 } from "../../../../shared/ui/icons";
import { Group } from "../../../settings/public/settingsControls";
import type { ProjectCrews } from "../../model/crewClient";
import {
  modelPoolDraftIssue,
  modelPoolUsage,
  newModelPoolDraft,
  useCrewModelPools,
  type CrewModelPool,
  type CrewModelPoolDraft,
} from "../../model/crewModelPools";
import { MemberCandidateList } from "../MemberCandidateList";

const message = (reason: unknown) => (reason instanceof Error ? reason.message : String(reason));
const countLabel = (count: number, one: string, many: string) =>
  count === 1 ? one : t(many, { p0: count });

/** One pool's size and how many profiles and crew members follow it. */
function poolMeta(pool: CrewModelPool, data: ProjectCrews) {
  const use = modelPoolUsage(pool.id, data);
  return [
    countLabel(pool.candidates.length, t("1 model"), "{p0} models"),
    use.profiles ? countLabel(use.profiles, t("1 profile"), "{p0} profiles") : "",
    use.members ? countLabel(use.members, t("1 member"), "{p0} members") : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

function PoolDialog({
  draft: initial,
  pools,
  data,
  pending,
  error,
  onSave,
  onClose,
}: {
  draft: CrewModelPoolDraft;
  pools: readonly CrewModelPool[];
  data: ProjectCrews;
  pending: boolean;
  error: string;
  onSave: (draft: CrewModelPoolDraft) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [attempted, setAttempted] = useState(false);
  const issue = modelPoolDraftIssue(draft, pools);
  const nameError =
    attempted && (issue === "name" || issue === "duplicate")
      ? issue === "name"
        ? t("Add a name")
        : t("Another pool already uses this name")
      : undefined;
  return (
    <Modal
      title={initial.updatedAt === undefined ? t("New model pool") : t("Edit model pool")}
      context={initial.name || undefined}
      size="md"
      onClose={() => {
        if (!pending) onClose();
      }}
      footer={
        <>
          <span className="min-w-0 flex-1" />
          <Button variant="ghost" disabled={pending} onClick={onClose}>
            {t("Cancel")}
          </Button>
          <Button
            variant="primary"
            loading={pending}
            onClick={() => (issue ? setAttempted(true) : onSave(draft))}
          >
            {t("Save")}
          </Button>
        </>
      }
    >
      <fieldset disabled={pending} className="flex min-w-0 flex-col gap-3 border-0">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <TextField
          label={t("Pool name")}
          value={draft.name}
          maxLength={80}
          autoFocus
          error={nameError}
          onChange={(event) => setDraft({ ...draft, name: event.target.value })}
        />
        <MemberCandidateList
          catalog={data.catalog}
          candidates={draft.candidates}
          onChange={(candidates) => setDraft({ ...draft, candidates })}
        />
        {attempted && issue === "models" ? (
          <Alert tone="danger">{t("Choose a model")}</Alert>
        ) : null}
        {attempted && issue === "limit" ? (
          <Alert tone="danger">{t("The model pool limit is reached. Delete a pool first.")}</Alert>
        ) : null}
      </fieldset>
    </Modal>
  );
}

/**
 * The Crews page's Models tab: the owner's named model pools. A pool is one set of
 * automatic candidates (models with Cost, Quality, effort and mode) that any library
 * profile or crew member can use instead of listing its own.
 */
export function CrewsModelPools({ data }: { data: ProjectCrews }) {
  useLocale();
  const hostPools = useCrewModelPools(data.machine.id, data.modelPoolsSupported === true);
  const { pools, save, remove } = hostPools;
  const [editing, setEditing] = useState<CrewModelPoolDraft | null>(null);
  const [error, setError] = useState("");
  const confirm = useConfirm();
  const close = () => {
    setEditing(null);
    setError("");
    save.reset();
  };
  const askDelete = async (pool: CrewModelPool) => {
    const ok = await confirm.confirm({
      title: t("Delete {p0}?", { p0: pool.name }),
      message: t("Members keep their current models and stop following this pool."),
      confirmLabel: t("Delete"),
    });
    if (ok)
      remove.mutate(pool, {
        onError: (reason) => setError(message(reason)),
        onSuccess: () => setError(""),
      });
  };
  return (
    <div className="settings-topics p-4">
      <Group
        title={t("Model pools")}
        info={t(
          "Define automatic model choices once and give a pool to any member. Editing a pool updates every member that uses it.",
        )}
        descriptionVisible={false}
        action={
          <Button
            variant="ghost"
            startIcon={<Plus className="icon-sm" />}
            disabled={!hostPools.supported}
            onClick={() => setEditing(newModelPoolDraft(crypto.randomUUID()))}
          >
            {t("New pool")}
          </Button>
        }
      >
        {error && !editing ? <Alert tone="danger">{error}</Alert> : null}
        {hostPools.loading ? (
          <LoadingText>{t("Loading…")}</LoadingText>
        ) : hostPools.error ? (
          <EmptyState size="inline" kind="unavailable" description={hostPools.error} />
        ) : !pools.length ? (
          <EmptyState size="inline" kind="empty" description={t("No model pools yet.")} />
        ) : (
          <div className="settings-collection">
            <div className="settings-collection-list max-h-none! overflow-visible!" role="list">
              {pools.map((pool) => (
                <div key={pool.id} role="listitem" className="settings-collection-row">
                  <div className="settings-collection-main">
                    <div className="settings-collection-title min-w-0">{pool.name}</div>
                    <div className="settings-collection-meta">{poolMeta(pool, data)}</div>
                  </div>
                  <div className="settings-collection-actions shrink-0">
                    <Button
                      variant="ghost"
                      aria-label={t("Edit {p0}", { p0: pool.name })}
                      onClick={() => setEditing(structuredClone(pool))}
                    >
                      {t("Edit")}
                    </Button>
                    <Button
                      variant="ghost"
                      iconOnly
                      label={t("Delete {p0}", { p0: pool.name })}
                      loading={remove.isPending && remove.variables?.id === pool.id}
                      onClick={() => void askDelete(pool)}
                    >
                      <Trash2 className="icon-sm" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Group>
      {editing ? (
        <PoolDialog
          draft={editing}
          pools={pools}
          data={data}
          pending={save.isPending}
          error={error}
          onClose={close}
          onSave={(draft) => {
            setError("");
            save.mutate(draft, {
              onSuccess: close,
              onError: (reason) => setError(message(reason)),
            });
          }}
        />
      ) : null}
      {confirm.dialog}
    </div>
  );
}
