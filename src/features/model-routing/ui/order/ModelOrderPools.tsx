import { useT } from "../../../../shared/i18n";
import { MODEL_ROUTING_MAX_POOLS } from "../../../../shared/model/host-contracts/model-routing";
import { Button } from "../../../../shared/ui/Button";
import { EmptyState } from "../../../../shared/ui/EmptyState";
import { TextField } from "../../../../shared/ui/TextField";
import { Trash2 } from "../../../../shared/ui/icons";
import { Group } from "../../../settings/public/settingsControls";
import { removeOrderPool, type OrderDraft } from "../../model/modelRoutingDraft";
import { PoolMembers } from "./PoolMembers";

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
            <EmptyState size="inline" title={t("No pools")} description="" />
          </div>
        )}
        {pools.map((pool) => (
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
            <PoolMembers draft={draft} pool={pool} onEdit={onEdit} />
          </div>
        ))}
      </>
    </Group>
  );
}
