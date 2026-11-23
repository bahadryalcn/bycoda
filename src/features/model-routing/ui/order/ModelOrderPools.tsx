import { useT } from "../../../../shared/i18n";
import {
  MODEL_ROUTING_MAX_POOLS,
  type ModelRoutingPool,
} from "../../../../shared/model/host-contracts/model-routing";
import { InfoTooltip } from "../../../../shared/ui/InfoPopover";
import { SegmentedControl } from "../../../../shared/ui/SegmentedControl";
import { Button } from "../../../../shared/ui/Button";
import { EmptyState } from "../../../../shared/ui/EmptyState";
import { TextField } from "../../../../shared/ui/TextField";
import { Trash2 } from "../../../../shared/ui/icons";
import { Group } from "../../../../shared/ui/settings";
import { nextOrderPoolName, removeOrderPool, type OrderDraft } from "../../model/modelRoutingDraft";
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
  // A group is only a draft edit until Save and Discard reverts it, so removing needs no confirmation.
  const removePool = (pool: ModelRoutingPool) =>
    onEdit((current) => removeOrderPool(current, pool.id));
  return (
    <Group
      title={t("Groups")}
      layout="full"
      action={
        <Button
          size="sm"
          disabled={!entries.length || pools.length >= MODEL_ROUTING_MAX_POOLS}
          disabledReason={
            !entries.length
              ? t("Add a model first.")
              : pools.length >= MODEL_ROUTING_MAX_POOLS
                ? t("The group limit is reached.")
                : undefined
          }
          onClick={() =>
            onChange({
              ...draft,
              routing: {
                ...draft.routing,
                pools: [
                  ...pools,
                  {
                    id: crypto.randomUUID(),
                    name: nextOrderPoolName(pools, t("New group")),
                    entryIds: [entries[0]!.id],
                  },
                ],
              },
            })
          }
        >
          {t("New group")}
        </Button>
      }
    >
      <>
        {!pools.length && <EmptyState size="inline" title={t("No groups")} description="" />}
        {pools.map((pool) => (
          <div
            key={pool.id}
            role="group"
            aria-label={pool.name || t("Unnamed group")}
            className="flex flex-col gap-2 px-4 py-3"
          >
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <TextField
                  label={t("Group name")}
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
              <div className="flex shrink-0 items-center gap-1">
                <SegmentedControl
                  label={t("Effort of {p0}", { p0: pool.name || t("Unnamed group") })}
                  value={pool.effort ?? "default"}
                  onValueChange={(effort) =>
                    onChange({
                      ...draft,
                      routing: {
                        ...draft.routing,
                        pools: pools.map((candidate) => {
                          if (candidate.id !== pool.id) return candidate;
                          const { effort: _previous, ...rest } = candidate;
                          return effort === "default"
                            ? rest
                            : { ...rest, effort: effort as ModelRoutingPool["effort"] };
                        }),
                      },
                    })
                  }
                  options={[
                    { value: "default", label: t("Default") },
                    { value: "low", label: t("Low") },
                    { value: "medium", label: t("Medium") },
                    { value: "high", label: t("High") },
                  ]}
                />
                <InfoTooltip label={t("Group effort")}>
                  {t(
                    "Work that runs on this group uses this effort on every model that supports it, including models of included groups. Default keeps each model's own setting.",
                  )}
                </InfoTooltip>
              </div>
              <Button
                iconOnly
                variant="ghost"
                label={t("Delete group {p0}", { p0: pool.name || t("Unnamed group") })}
                onClick={() => removePool(pool)}
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
