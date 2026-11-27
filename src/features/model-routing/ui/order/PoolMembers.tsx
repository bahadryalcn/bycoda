import { useRef, useState, type ReactNode } from "react";
import { useFormat, useT } from "../../../../shared/i18n";
import { useAnimatedReorder } from "../../../../shared/hooks/useAnimatedReorder";
import type {
  ModelRoutingEntry,
  ModelRoutingPool,
} from "../../../../shared/model/host-contracts/model-routing";
import { modelRoutingPoolEntryIds } from "../../../../shared/model/modelRoutingPools";
import { Button } from "../../../../shared/ui/Button";
import { DropdownMenu } from "../../../../shared/ui/DropdownMenu";
import { Text } from "../../../../shared/ui/Text";
import { FolderTree, GripVertical, Plus, X } from "../../../../shared/ui/icons";
import { REMOTE_PROVIDERS, isRemoteProvider } from "../../../connections/public/protocol";
import { ModelPicker } from "../../../sessions/public/ModelPicker";
import { useModelSource } from "../../../sessions/public/modelSource";
import {
  addPoolModel,
  includablePools,
  poolMemberValues,
  replacePoolModel,
  setPoolMemberSettings,
  setPoolMembers,
  type OrderDraft,
  type PoolTarget,
} from "../../model/modelRoutingDraft";

type Members = { entryIds: string[]; poolIds: string[] };
type Edit = (operation: (draft: OrderDraft) => OrderDraft) => void;

/** Grip, position or icon, content and remove: one table line of a group. */
function MemberRow({
  id,
  label,
  lead,
  count,
  sortable,
  onRemove,
  children,
}: {
  id: string;
  label: string;
  lead: ReactNode;
  count: number;
  sortable: ReturnType<typeof useAnimatedReorder<string>>;
  onRemove: () => void;
  children: ReactNode;
}) {
  const t = useT();
  return (
    <div
      ref={(node) => sortable.setItemRef(id, node)}
      className="reorder-item grid grid-cols-[auto_1.25rem_minmax(0,1fr)_auto] items-center gap-x-2 py-1"
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
        disabledReason={t("Add another model to reorder.")}
        onPointerDown={(event) => sortable.onItemPointerDown(id, event)}
        onKeyDown={(event) => sortable.onItemKeyDown(id, event)}
      >
        <GripVertical className="icon-sm" />
      </Button>
      <span className="flex justify-center">{lead}</span>
      <div className="flex min-w-0 items-center gap-2">{children}</div>
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

/** One model of a group, chosen and tuned (effort, speed) with the shared model picker. */
function EntryMember({
  pool,
  entry,
  position,
  count,
  sortable,
  onEdit,
  onRemove,
}: {
  pool: ModelRoutingPool;
  entry: ModelRoutingEntry;
  position: number;
  count: number;
  sortable: ReturnType<typeof useAnimatedReorder<string>>;
  onEdit: Edit;
  onRemove: () => void;
}) {
  const format = useFormat();
  const source = useModelSource();
  const name = source.resolve(entry.harness, entry.model).name;
  return (
    <MemberRow
      id={entry.id}
      label={name}
      count={count}
      sortable={sortable}
      onRemove={onRemove}
      lead={
        <Text size="secondary" tone="secondary" aria-hidden="true">
          {format.formatNumber(position)}
        </Text>
      }
    >
      <div className="min-w-0 flex-1">
        <ModelPicker
          harness={entry.harness}
          model={entry.model}
          values={poolMemberValues(pool, entry)}
          allowedHarnesses={REMOTE_PROVIDERS}
          presentation="field"
          showExtras
          hideAgentSettings
          accountChoices
          accountId={entry.providerAccountId}
          onChange={(harness, model, providerAccountId) => {
            if (!isRemoteProvider(harness)) return;
            onEdit((draft) =>
              replacePoolModel(draft, pool.id, entry.id, { harness, model, providerAccountId }),
            );
          }}
          onSettingsChange={(settings) =>
            onEdit((draft) => setPoolMemberSettings(draft, pool.id, entry.id, settings))
          }
        />
      </div>
    </MemberRow>
  );
}

/**
 * Opens the full shared model picker (models and settings, as in the composer) from an Add button.
 * A pick adds the model to the group and the picker stays open on it; effort and speed chosen
 * before the pick are applied to the added model.
 */
function AddModel({
  pool,
  entries,
  onEdit,
}: {
  pool: ModelRoutingPool;
  entries: ModelRoutingEntry[];
  onEdit: Edit;
}) {
  const t = useT();
  const source = useModelSource();
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  // Settings edit the picked model, never another member; chosen before a pick they wait for it.
  const [picked, setPicked] = useState<PoolTarget | null>(null);
  const [pending, setPending] = useState<Record<string, string>>({});
  const added = picked
    ? entries.find(
        (entry) =>
          pool.entryIds.includes(entry.id) &&
          entry.harness === picked.harness &&
          entry.model === picked.model &&
          (entry.providerAccountId ?? "default") === (picked.providerAccountId ?? "default"),
      )
    : undefined;
  const last =
    added ??
    entries.find((entry) => entry.id === pool.entryIds[pool.entryIds.length - 1]) ??
    entries[0];
  const harness = last && isRemoteProvider(last.harness) ? last.harness : REMOTE_PROVIDERS[0]!;
  return (
    <>
      <Button
        ref={anchor}
        size="sm"
        variant="ghost"
        startIcon={<Plus className="icon-sm" />}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setPicked(null);
          setPending({});
          setOpen((current) => !current);
        }}
      >
        {t("Add model")}
      </Button>
      {open ? (
        <ModelPicker
          harness={harness}
          model={last?.harness === harness ? last.model : source.resolve(harness).id}
          values={added ? poolMemberValues(pool, added) : { ...last?.modelSettings, ...pending }}
          allowedHarnesses={REMOTE_PROVIDERS}
          presentation="field"
          accountChoices
          accountId={last?.harness === harness ? last.providerAccountId : undefined}
          showExtras
          hideAgentSettings
          openRequest={1}
          externalTrigger={{ anchor, onDismiss: () => setOpen(false) }}
          onChange={(picked, model, providerAccountId) => {
            if (!isRemoteProvider(picked)) return;
            const target = { harness: picked, model, providerAccountId };
            onEdit((draft) => {
              const next = addPoolModel(draft, pool.id, target);
              if (!Object.keys(pending).length) return next;
              // addPoolModel appends the picked model last.
              const ids = next.routing.pools.find(
                (candidate) => candidate.id === pool.id,
              )!.entryIds;
              return setPoolMemberSettings(next, pool.id, ids[ids.length - 1]!, pending);
            });
            setPicked(target);
            setPending({});
          }}
          onSettingsChange={(settings) => {
            if (!added) {
              setPending((current) => ({ ...current, ...settings }));
              return;
            }
            onEdit((draft) => setPoolMemberSettings(draft, pool.id, added.id, settings));
          }}
        />
      ) : null}
    </>
  );
}

/** A group's models, then its included groups, in resolution order, with add actions. */
export function PoolMembers({
  draft,
  pool,
  onEdit,
}: {
  draft: OrderDraft;
  pool: ModelRoutingPool;
  onEdit: Edit;
}) {
  const t = useT();
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
  const addablePools = includablePools(draft, pool.id).filter(
    (other) => !poolIds.includes(other.id),
  );
  const [includeOpen, setIncludeOpen] = useState(false);
  const includeAnchor = useRef<HTMLButtonElement>(null);
  return (
    <div className="flex flex-col">
      {pool.entryIds.map((id, index) => {
        const entry = entries.find((candidate) => candidate.id === id);
        return entry ? (
          <EntryMember
            key={id}
            pool={pool}
            entry={entry}
            position={index + 1}
            count={pool.entryIds.length}
            sortable={modelOrder}
            onEdit={onEdit}
            onRemove={() => apply({ ...members, entryIds: pool.entryIds.filter((x) => x !== id) })}
          />
        ) : null;
      })}
      {poolIds.map((id) => {
        const included = pools.find((candidate) => candidate.id === id);
        if (!included) return null;
        const name = included.name || t("Unnamed group");
        return (
          <MemberRow
            key={id}
            id={id}
            label={name}
            count={poolIds.length}
            sortable={groupOrder}
            onRemove={() => apply({ ...members, poolIds: poolIds.filter((x) => x !== id) })}
            lead={<FolderTree aria-hidden className="icon-sm" />}
          >
            <Text size="secondary" className="shrink-0">
              {name}
            </Text>
            {/* The included models by name, in their order, never a bare count. */}
            <Text size="caption" tone="secondary" className="min-w-0 break-words">
              {modelRoutingPoolEntryIds(pools, id)
                .flatMap((entryId) => {
                  const entry = entries.find((candidate) => candidate.id === entryId);
                  return entry ? [source.resolve(entry.harness, entry.model).name] : [];
                })
                .join(", ")}
            </Text>
          </MemberRow>
        );
      })}
      <div className="flex flex-wrap items-center gap-1 pt-1">
        <AddModel pool={pool} entries={entries} onEdit={onEdit} />
        <Button
          ref={includeAnchor}
          size="sm"
          variant="ghost"
          startIcon={<FolderTree className="icon-sm" />}
          disabled={!addablePools.length}
          disabledReason={t("No other group can be included.")}
          aria-haspopup="menu"
          aria-expanded={includeOpen}
          onClick={() => setIncludeOpen((current) => !current)}
        >
          {t("Include another group")}
        </Button>
        {includeOpen ? (
          <DropdownMenu
            anchor={includeAnchor}
            label={t("Include another group")}
            align="start"
            items={addablePools.map((other) => ({
              kind: "item" as const,
              id: other.id,
              label: other.name || t("Unnamed group"),
              icon: <FolderTree className="icon-sm" />,
            }))}
            onPick={(id) => apply({ ...members, poolIds: [...poolIds, id] })}
            onClose={() => setIncludeOpen(false)}
          />
        ) : null}
      </div>
    </div>
  );
}
