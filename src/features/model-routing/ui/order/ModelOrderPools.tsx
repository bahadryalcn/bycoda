import { useFormat, useT } from "../../../../shared/i18n";
import {
  MODEL_ROUTING_MAX_POOLS,
  type ModelRoutingPool,
} from "../../../../shared/model/host-contracts/model-routing";
import { modelRoutingPoolEntryIds } from "../../../../shared/model/modelRoutingPools";
import { Button } from "../../../../shared/ui/Button";
import { EmptyState } from "../../../../shared/ui/EmptyState";
import { Text } from "../../../../shared/ui/Text";
import { TextField } from "../../../../shared/ui/TextField";
import { Trash2 } from "../../../../shared/ui/icons";
import { Group } from "../../../../shared/ui/settings";
import { nextOrderPoolName, removeOrderPool, type OrderDraft } from "../../model/modelRoutingDraft";
import { PoolMembers } from "./PoolMembers";

/**
 * Every group open at once: its name, model count and delete on one line, then its models.
 * Each model carries its own effort and speed for runs on this group.
 */
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
  const format = useFormat();
  const { entries, pools } = draft.routing;
  // A group is only a draft edit until Save and Discard reverts it, so removing needs no confirmation.
  const removePool = (pool: ModelRoutingPool) =>
    onEdit((current) => removeOrderPool(current, pool.id));
  const rename = (pool: ModelRoutingPool, name: string) =>
    onChange({
      ...draft,
      routing: {
        ...draft.routing,
        pools: pools.map((candidate) =>
          candidate.id === pool.id ? { ...candidate, name } : candidate,
        ),
      },
    });
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
        {!pools.length && (
          <EmptyState
            size="inline"
            title={t("No groups")}
            description={
              entries.length
                ? t("A job set to a group tries its models in order.")
                : t("Add a model in Models & order first.")
            }
            showDescription
          />
        )}
        {pools.map((pool) => {
          const name = pool.name || t("Unnamed group");
          return (
            <section key={pool.id} aria-label={name} className="flex flex-col gap-1 px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="w-64 max-w-full min-w-0">
                  <TextField
                    label={t("Group name")}
                    hideLabel
                    fieldSize="sm"
                    maxLength={80}
                    value={pool.name}
                    onChange={(event) => rename(pool, event.currentTarget.value)}
                  />
                </div>
                <Text size="caption" tone="secondary" className="flex-1">
                  {t("{p0} models", {
                    p0: format.formatNumber(modelRoutingPoolEntryIds(pools, pool.id).length),
                  })}
                </Text>
                <Button
                  iconOnly
                  variant="ghost"
                  size="sm"
                  label={t("Delete group {p0}", { p0: name })}
                  onClick={() => removePool(pool)}
                >
                  <Trash2 className="icon-sm" />
                </Button>
              </div>
              <PoolMembers draft={draft} pool={pool} onEdit={onEdit} />
            </section>
          );
        })}
      </>
    </Group>
  );
}
