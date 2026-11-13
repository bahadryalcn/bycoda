import { useT } from "../../../../shared/i18n";
import { moveItem } from "../../../../shared/lib/reorder";
import { MODEL_ROUTING_MAX_POOLS } from "../../../../shared/model/host-contracts/model-routing";
import { Button } from "../../../../shared/ui/Button";
import { Checkbox } from "../../../../shared/ui/Checkbox";
import { EmptyState } from "../../../../shared/ui/EmptyState";
import { TextField } from "../../../../shared/ui/TextField";
import { ArrowDown, ArrowUp, Trash2 } from "../../../../shared/ui/icons";
import { Group } from "../../../settings/public/settingsControls";
import { ModelLabel } from "../../../sessions/public/ModelLabel";
import { removeOrderPool, setPoolEntries, type OrderDraft } from "../../model/modelRoutingDraft";

export function ModelOrderPools({
  draft,
  onChange,
  onEdit,
}: {
  draft: OrderDraft;
  onChange: (draft: OrderDraft) => void;
  onEdit: (operation: (draft: OrderDraft) => OrderDraft) => void;
}) {
  const t = useT();
  const { entries, pools } = draft.routing;
  return (
    <Group
      title={t("Pools")}
      layout="full"
      description={t(
        "Optional. A pool is a short list of models from the order, for jobs that should use only those models.",
      )}
      action={
        <Button
          size="sm"
          disabled={!entries.length || pools.length >= MODEL_ROUTING_MAX_POOLS}
          disabledReason={
            !entries.length
              ? t("Add a model first.")
              : pools.length >= MODEL_ROUTING_MAX_POOLS
                ? t("The pool limit is reached.")
                : undefined
          }
          onClick={() =>
            onChange({
              ...draft,
              routing: {
                ...draft.routing,
                pools: [
                  ...pools,
                  { id: crypto.randomUUID(), name: t("New pool"), entryIds: [entries[0]!.id] },
                ],
              },
            })
          }
        >
          {t("Create pool")}
        </Button>
      }
    >
      <>
        {!pools.length && (
          <div className="px-4 py-3">
            <EmptyState
              size="inline"
              title={t("No pools. Most setups need only the model order.")}
              description=""
            />
          </div>
        )}
        {pools.map((pool) => {
          const ordered = pool.entryIds.flatMap((id) => {
            const entry = entries.find((candidate) => candidate.id === id);
            return entry ? [entry] : [];
          });
          const available = entries.filter((entry) => !pool.entryIds.includes(entry.id));
          return (
            <div
              key={pool.id}
              role="group"
              aria-label={pool.name || t("Unnamed pool")}
              className="flex flex-col gap-2 px-4 py-3"
            >
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <TextField
                    label={t("Pool name")}
                    hideLabel
                    maxLength={80}
                    value={pool.name}
                    onChange={(event) =>
                      onChange({
                        ...draft,
                        routing: {
                          ...draft.routing,
                          pools: pools.map((candidate) =>
                            candidate.id === pool.id
                              ? { ...candidate, name: event.currentTarget.value }
                              : candidate,
                          ),
                        },
                      })
                    }
                  />
                </div>
                <Button
                  iconOnly
                  variant="ghost"
                  label={t("Delete pool {p0}", { p0: pool.name })}
                  onClick={() => onEdit((current) => removeOrderPool(current, pool.id))}
                >
                  <Trash2 className="icon-sm" />
                </Button>
              </div>
              {[...ordered, ...available].map((entry) => {
                const index = pool.entryIds.indexOf(entry.id);
                return (
                  <div key={entry.id} className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <Checkbox
                        size="secondary"
                        label={<ModelLabel model={entry.model} harness={entry.harness} />}
                        checked={index !== -1}
                        onChange={(event) => {
                          const entryIds = event.currentTarget.checked
                            ? [...pool.entryIds, entry.id]
                            : pool.entryIds.filter((id) => id !== entry.id);
                          onEdit((current) => setPoolEntries(current, pool.id, entryIds));
                        }}
                      />
                    </div>
                    {index !== -1 && pool.entryIds.length > 1 && (
                      <>
                        <Button
                          iconOnly
                          variant="ghost"
                          size="sm"
                          label={t("Move pool model up")}
                          disabled={index === 0}
                          onClick={() =>
                            onEdit((current) =>
                              setPoolEntries(
                                current,
                                pool.id,
                                moveItem(pool.entryIds, index, index - 1),
                              ),
                            )
                          }
                        >
                          <ArrowUp className="icon-sm" />
                        </Button>
                        <Button
                          iconOnly
                          variant="ghost"
                          size="sm"
                          label={t("Move pool model down")}
                          disabled={index === pool.entryIds.length - 1}
                          onClick={() =>
                            onEdit((current) =>
                              setPoolEntries(
                                current,
                                pool.id,
                                moveItem(pool.entryIds, index, index + 1),
                              ),
                            )
                          }
                        >
                          <ArrowDown className="icon-sm" />
                        </Button>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </>
    </Group>
  );
}
