import { useState } from "react";
import { useT } from "../../../../shared/i18n";
import {
  MODEL_ROUTING_MAX_POOLS,
  type ModelRoutingPool,
} from "../../../../shared/model/host-contracts/model-routing";
import { useConfirm } from "../../../../shared/ui/ConfirmDialog";
import { SegmentedControl } from "../../../../shared/ui/SegmentedControl";
import { SectionLabel } from "../../../../shared/ui/SectionLabel";
import { Button } from "../../../../shared/ui/Button";
import { EmptyState } from "../../../../shared/ui/EmptyState";
import { TextField } from "../../../../shared/ui/TextField";
import { Trash2 } from "../../../../shared/ui/icons";
import { FieldGroup } from "../../../../shared/ui/FieldGroup";
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
  const { confirm, dialog } = useConfirm();
  const { entries, pools } = draft.routing;
  const [expanded, setExpanded] = useState<string | undefined>(() => pools[0]?.id);
  const removePool = async (pool: ModelRoutingPool) => {
    const ok = await confirm({
      title: t("Delete group {p0}?", { p0: pool.name || t("Unnamed group") }),
      message: t(
        "Its models stay in the list. A job that uses this group blocks the delete until you change that job.",
      ),
      confirmLabel: t("Delete"),
    });
    if (ok) onEdit((current) => removeOrderPool(current, pool.id));
  };
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
          onClick={() => {
            const id = crypto.randomUUID();
            onChange({
              ...draft,
              routing: {
                ...draft.routing,
                pools: [
                  ...pools,
                  {
                    id,
                    name: nextOrderPoolName(pools, t("New group")),
                    entryIds: [entries[0]!.id],
                  },
                ],
              },
            });
            setExpanded(id);
          }}
        >
          {t("New group")}
        </Button>
      }
    >
      <>
        {!pools.length && (
          <div className="px-4 py-3">
            <EmptyState size="inline" title={t("No groups")} description="" />
          </div>
        )}
        {pools.map((pool) => (
          <div
            key={pool.id}
            role="group"
            aria-label={pool.name || t("Unnamed group")}
            className="flex flex-col gap-2 px-4 py-3"
          >
            <SectionLabel
              collapsible
              expanded={expanded === pool.id}
              onExpandedChange={(open) => setExpanded(open ? pool.id : undefined)}
              controls={`routing-pool-${pool.id}`}
              count={pool.entryIds.length + (pool.poolIds?.length ?? 0)}
              actions={
                <Button
                  iconOnly
                  variant="ghost"
                  label={t("Delete group {p0}", { p0: pool.name || t("Unnamed group") })}
                  onClick={() => void removePool(pool)}
                >
                  <Trash2 className="icon-sm" />
                </Button>
              }
            >
              {pool.name || t("Unnamed group")}
            </SectionLabel>
            <div id={`routing-pool-${pool.id}`} hidden={expanded !== pool.id}>
              {expanded === pool.id ? (
                <>
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="min-w-0 flex-1">
                      <TextField
                        label={t("Group name")}
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
                    <FieldGroup
                      legend={t("Group effort")}
                      description={t(
                        "Work that runs on this group uses this effort on every model that supports it, including models of included groups. Default keeps each model's own setting.",
                      )}
                    >
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
                    </FieldGroup>
                  </div>
                  <PoolMembers draft={draft} pool={pool} onEdit={onEdit} />
                </>
              ) : null}
            </div>
          </div>
        ))}
        {dialog}
      </>
    </Group>
  );
}
