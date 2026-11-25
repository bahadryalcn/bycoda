import { useRef, useState, type ComponentProps, type ReactNode } from "react";
import { useFormat, useT } from "../../../../shared/i18n";
import { useAnimatedReorder } from "../../../../shared/hooks/useAnimatedReorder";
import type {
  ModelRoutingEntry,
  ModelRoutingPool,
} from "../../../../shared/model/host-contracts/model-routing";
import { modelRoutingPoolEntryIds } from "../../../../shared/model/modelRoutingPools";
import { Button } from "../../../../shared/ui/Button";
import { DropdownMenu, type DropdownMenuItem } from "../../../../shared/ui/DropdownMenu";
import { Text } from "../../../../shared/ui/Text";
import { FolderTree, GripVertical, Plus, X } from "../../../../shared/ui/icons";
import { ModelLabel } from "../../../sessions/public/ModelLabel";
import { useModelSource } from "../../../sessions/public/modelSource";
import { includablePools, setPoolMembers, type OrderDraft } from "../../model/modelRoutingDraft";
import { entryProviderAccount, useEntryAccount } from "./useEntryAccount";

type Members = { entryIds: string[]; poolIds: string[] };

function MemberFrame({
  id,
  label,
  count,
  sortable,
  onRemove,
  children,
}: {
  id: string;
  label: string;
  count: number;
  sortable: ReturnType<typeof useAnimatedReorder<string>>;
  onRemove: () => void;
  children: ReactNode;
}) {
  const t = useT();
  return (
    <div
      ref={(node) => sortable.setItemRef(id, node)}
      className="reorder-item flex w-full max-w-xl items-center gap-2"
      data-dragging={sortable.draggingId === id ? "" : undefined}
      role="group"
      aria-label={label}
    >
      <Button
        iconOnly
        variant="ghost"
        size="sm"
        label={t("Reorder in {p0}", { p0: label })}
        tooltip={t("Drag to reorder")}
        shortcut="Alt+↑ / Alt+↓"
        disabled={count < 2}
        onPointerDown={(event) => sortable.onItemPointerDown(id, event)}
        onKeyDown={(event) => sortable.onItemKeyDown(id, event)}
      >
        <GripVertical className="icon-sm" />
      </Button>
      <div className="flex min-w-0 flex-1 items-center gap-2">{children}</div>
      <Button
        iconOnly
        variant="ghost"
        size="sm"
        label={t("Remove {p0} from group", { p0: label })}
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
  const source = useModelSource();
  const name = source.resolve(entry.harness, entry.model).name;
  return (
    <MemberFrame label={name} {...frame}>
      <Text as="span" size="secondary" className="min-w-0">
        <ModelLabel model={entry.model} harness={entry.harness} name={name} />
      </Text>
      {account.account ? (
        <Text size="caption" tone="secondary" truncate>
          {account.account.label}
        </Text>
      ) : null}
    </MemberFrame>
  );
}

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
  const source = useModelSource();
  const { entries, pools } = draft.routing;
  const poolIds = pool.poolIds ?? [];
  const members: Members = { entryIds: pool.entryIds, poolIds };
  const apply = (next: Members) => onEdit((current) => setPoolMembers(current, pool.id, next));
  const modelOrder = useAnimatedReorder(
    pool.entryIds,
    (ids) => apply({ ...members, entryIds: ids }),
    "y",
  );
  const groupOrder = useAnimatedReorder(poolIds, (ids) => apply({ ...members, poolIds: ids }), "y");
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
            items: addableEntries.map((entry) => {
              // Same model on two accounts must read apart: the account is part of the row.
              const account = entryProviderAccount(entry, source)?.label;
              const name = source.resolve(entry.harness, entry.model).name;
              return {
                kind: "item" as const,
                id: `entry:${entry.id}`,
                label: account ? `${name} · ${account}` : name,
                content: (
                  <span className="flex min-w-0 items-baseline gap-2">
                    <ModelLabel model={entry.model} harness={entry.harness} />
                    {account ? (
                      <Text as="span" size="caption" tone="secondary" truncate>
                        {account}
                      </Text>
                    ) : null}
                  </span>
                ),
              };
            }),
          },
        ]
      : []),
    ...(addablePools.length
      ? [
          {
            kind: "group" as const,
            id: "pools",
            label: t("Groups"),
            items: addablePools.map((other) => ({
              kind: "item" as const,
              id: `pool:${other.id}`,
              label: other.name || t("Unnamed group"),
              icon: <FolderTree className="icon-sm" />,
            })),
          },
        ]
      : []),
  ];
  return (
    <div className="flex flex-col gap-1 ps-2">
      {pool.entryIds.map((id) => {
        const entry = entries.find((candidate) => candidate.id === id);
        return entry ? (
          <EntryMember
            key={id}
            entry={entry}
            id={id}
            count={pool.entryIds.length}
            sortable={modelOrder}
            onRemove={() => apply({ ...members, entryIds: pool.entryIds.filter((x) => x !== id) })}
          />
        ) : null;
      })}
      {poolIds.map((id) => {
        const included = pools.find((candidate) => candidate.id === id);
        if (!included) return null;
        const name = included.name || t("Unnamed group");
        return (
          <MemberFrame
            key={id}
            label={name}
            id={id}
            count={poolIds.length}
            sortable={groupOrder}
            onRemove={() => apply({ ...members, poolIds: poolIds.filter((x) => x !== id) })}
          >
            <FolderTree aria-hidden className="icon-sm shrink-0" />
            <Text size="secondary" truncate>
              {name}
            </Text>
            <Text size="caption" tone="secondary">
              {t("{p0} models", {
                p0: format.formatNumber(modelRoutingPoolEntryIds(pools, id).length),
              })}
            </Text>
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
          disabledReason={
            !items.length ? t("No models or groups are available to add.") : undefined
          }
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
        >
          {t("Add")}
        </Button>
        {open ? (
          <DropdownMenu
            anchor={anchor}
            label={t("Add to group")}
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
