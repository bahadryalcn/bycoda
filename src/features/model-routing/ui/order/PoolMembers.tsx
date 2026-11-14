import { useRef, useState, type ComponentProps, type ReactNode } from "react";
import { useFormat, useT } from "../../../../shared/i18n";
import { moveItem } from "../../../../shared/lib/reorder";
import type {
  ModelRoutingEntry,
  ModelRoutingPool,
} from "../../../../shared/model/host-contracts/model-routing";
import { modelRoutingPoolEntryIds } from "../../../../shared/model/modelRoutingPools";
import { Badge } from "../../../../shared/ui/Badge";
import { Button } from "../../../../shared/ui/Button";
import { DropdownMenu, type DropdownMenuItem } from "../../../../shared/ui/DropdownMenu";
import { Text } from "../../../../shared/ui/Text";
import { ArrowDown, ArrowUp, FolderTree, Plus, X } from "../../../../shared/ui/icons";
import { ModelLabel } from "../../../sessions/public/ModelLabel";
import { resolveModel } from "../../../sessions/public/models";
import { includablePools, setPoolMembers, type OrderDraft } from "../../model/modelRoutingDraft";
import { useEntryAccount } from "./useEntryAccount";

type Members = { entryIds: string[]; poolIds: string[] };

function MemberFrame({
  label,
  index,
  count,
  onMove,
  onRemove,
  children,
}: {
  label: string;
  index: number;
  count: number;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
  children: ReactNode;
}) {
  const t = useT();
  return (
    <div className="flex items-center gap-1" role="group" aria-label={label}>
      <div className="flex min-w-0 flex-1 items-center gap-2">{children}</div>
      <Button
        iconOnly
        variant="ghost"
        size="sm"
        label={t("Move {p0} up", { p0: label })}
        disabled={index === 0}
        onClick={() => onMove(-1)}
      >
        <ArrowUp className="icon-sm" />
      </Button>
      <Button
        iconOnly
        variant="ghost"
        size="sm"
        label={t("Move {p0} down", { p0: label })}
        disabled={index === count - 1}
        onClick={() => onMove(1)}
      >
        <ArrowDown className="icon-sm" />
      </Button>
      <Button
        iconOnly
        variant="ghost"
        size="sm"
        label={t("Remove {p0} from pool", { p0: label })}
        onClick={onRemove}
      >
        <X className="icon-sm" />
      </Button>
    </div>
  );
}

function EntryMember({
  entry,
  ...frame
}: { entry: ModelRoutingEntry } & Omit<ComponentProps<typeof MemberFrame>, "label" | "children">) {
  const account = useEntryAccount(entry);
  const name = entryName(entry);
  return (
    <MemberFrame label={name} {...frame}>
      <ModelLabel model={entry.model} harness={entry.harness} />
      {account.account ? (
        <Text size="caption" tone="secondary" truncate>
          {account.account.label}
        </Text>
      ) : null}
    </MemberFrame>
  );
}

const entryName = (entry: ModelRoutingEntry) => resolveModel(entry.harness, entry.model).name;

/** Models, then included pools, of one pool in resolution order, plus an Add menu. */
export function PoolMembers({
  draft,
  pool,
  onEdit,
}: {
  draft: OrderDraft;
  pool: ModelRoutingPool;
  onEdit: (operation: (draft: OrderDraft) => OrderDraft) => void;
}) {
  const t = useT();
  const format = useFormat();
  const { entries, pools } = draft.routing;
  const poolIds = pool.poolIds ?? [];
  const members: Members = { entryIds: pool.entryIds, poolIds };
  const apply = (next: Members) => onEdit((current) => setPoolMembers(current, pool.id, next));
  const addableEntries = entries.filter((entry) => !pool.entryIds.includes(entry.id));
  const addablePools = includablePools(draft, pool.id).filter(
    (other) => !poolIds.includes(other.id),
  );
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const items: DropdownMenuItem[] = [
    ...(addableEntries.length
      ? [
          {
            kind: "group" as const,
            id: "models",
            label: t("Models"),
            items: addableEntries.map((entry) => ({
              kind: "item" as const,
              id: `entry:${entry.id}`,
              label: entryName(entry),
              content: <ModelLabel model={entry.model} harness={entry.harness} />,
            })),
          },
        ]
      : []),
    ...(addablePools.length
      ? [
          {
            kind: "group" as const,
            id: "pools",
            label: t("Pools"),
            items: addablePools.map((other) => ({
              kind: "item" as const,
              id: `pool:${other.id}`,
              label: other.name || t("Unnamed pool"),
              icon: <FolderTree className="icon-sm" />,
            })),
          },
        ]
      : []),
  ];
  return (
    <div className="flex flex-col gap-1 ps-2">
      {pool.entryIds.map((id, index) => {
        const entry = entries.find((candidate) => candidate.id === id);
        return entry ? (
          <EntryMember
            key={id}
            entry={entry}
            index={index}
            count={pool.entryIds.length}
            onMove={(delta) =>
              apply({ ...members, entryIds: moveItem(pool.entryIds, index, index + delta) })
            }
            onRemove={() => apply({ ...members, entryIds: pool.entryIds.filter((x) => x !== id) })}
          />
        ) : null;
      })}
      {poolIds.map((id, index) => {
        const included = pools.find((candidate) => candidate.id === id);
        if (!included) return null;
        const name = included.name || t("Unnamed pool");
        return (
          <MemberFrame
            key={id}
            label={name}
            index={index}
            count={poolIds.length}
            onMove={(delta) =>
              apply({ ...members, poolIds: moveItem(poolIds, index, index + delta) })
            }
            onRemove={() => apply({ ...members, poolIds: poolIds.filter((x) => x !== id) })}
          >
            <FolderTree aria-hidden className="icon-sm shrink-0" />
            <Text size="secondary" truncate>
              {name}
            </Text>
            <Badge size="xs">
              {t("{p0} models", {
                p0: format.formatNumber(modelRoutingPoolEntryIds(pools, id).length),
              })}
            </Badge>
          </MemberFrame>
        );
      })}
      <div>
        <Button
          ref={anchor}
          size="sm"
          variant="ghost"
          startIcon={<Plus className="icon-sm" />}
          disabled={!items.length}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
        >
          {t("Add")}
        </Button>
        {open ? (
          <DropdownMenu
            anchor={anchor}
            label={t("Add to pool")}
            align="start"
            items={items}
            onPick={(id) =>
              apply(
                id.startsWith("pool:")
                  ? { ...members, poolIds: [...poolIds, id.slice(5)] }
                  : { ...members, entryIds: [...pool.entryIds, id.slice(6)] },
              )
            }
            onClose={() => setOpen(false)}
          />
        ) : null}
      </div>
    </div>
  );
}
