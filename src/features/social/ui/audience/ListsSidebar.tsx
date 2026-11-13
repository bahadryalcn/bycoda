import { useState } from "react";
import { t } from "../../../../shared/i18n";
import { ActionHost, InlineMoreAction } from "../../../../shared/ui/ActionHost";
import { Badge } from "../../../../shared/ui/Badge";
import { Button } from "../../../../shared/ui/Button";
import { DropdownMenu, type DropdownMenuItem } from "../../../../shared/ui/DropdownMenu";
import { EmptyState } from "../../../../shared/ui/EmptyState";
import { ListBullet, ListFilter, Plus, UserRound } from "../../../../shared/ui/icons";
import { SectionLabel } from "../../../../shared/ui/SectionLabel";
import { Text } from "../../../../shared/ui/Text";
import type { SocialList } from "../../model/audience";
import { collectionKind, listDisplayName } from "./audienceModel";
import "./audience.css";

export type ListsSidebarProps = {
  lists: readonly SocialList[];
  /** null means "All people". */
  selectedId: string | null;
  onSelect: (listId: string | null) => void;
  onNewList: () => void;
  onNewSegment: () => void;
  /** Rename a list or edit a segment's conditions. Never called for the system Commenters list. */
  onEdit: (list: SocialList) => void;
  onDelete: (list: SocialList) => void;
};

type OpenMenu = { listId: string; anchor: HTMLButtonElement };

function menuItems(list: SocialList): DropdownMenuItem[] {
  const kind = collectionKind(list);
  if (kind === "commenters") {
    return [
      {
        kind: "item",
        id: "locked",
        label: t("Automatic list"),
        description: t("The Commenters rule fills this list, so it cannot be renamed or deleted."),
        disabled: true,
      },
    ];
  }
  return [
    {
      kind: "item",
      id: "edit",
      label: kind === "segment" ? t("Edit segment…") : t("Rename list…"),
    },
    { kind: "sep" },
    { kind: "item", id: "delete", label: t("Delete…"), danger: true },
  ];
}

function CollectionRow({
  list,
  selected,
  menuOpen,
  onSelect,
  onOpenMenu,
}: {
  list: SocialList;
  selected: boolean;
  menuOpen: boolean;
  onSelect: (listId: string) => void;
  onOpenMenu: (anchor: HTMLButtonElement) => void;
}) {
  const kind = collectionKind(list);
  const name = listDisplayName(list);
  return (
    <ActionHost as="li" selected={selected} className="audience-collection-row">
      <Button
        variant="item"
        size="sm"
        selected={selected}
        className="audience-collection-main"
        startIcon={
          kind === "segment" ? (
            <ListFilter className="icon-sm" aria-hidden="true" />
          ) : (
            <ListBullet className="icon-sm" aria-hidden="true" />
          )
        }
        aria-current={selected ? "true" : undefined}
        onClick={() => onSelect(list.id)}
      >
        <Text size="inherit" tone="inherit" leading="inherit" truncate>
          {name}
        </Text>
        {kind === "commenters" ? (
          <Badge size="xs" tone="neutral" className="shrink-0">
            {t("Automatic")}
          </Badge>
        ) : null}
      </Button>
      <InlineMoreAction
        label={t("Actions for {p0}", { p0: name })}
        expanded={menuOpen}
        onOpen={onOpenMenu}
      />
    </ActionHost>
  );
}

/**
 * Left column of the people view: everyone, the lists you fill by hand (the system Commenters list
 * included) and the segments that fill themselves. Each custom row has a menu to edit or delete it.
 */
export function ListsSidebar({
  lists,
  selectedId,
  onSelect,
  onNewList,
  onNewSegment,
  onEdit,
  onDelete,
}: ListsSidebarProps) {
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const statics = lists.filter((list) => collectionKind(list) !== "segment");
  const segments = lists.filter((list) => collectionKind(list) === "segment");
  const menuList = menu ? lists.find((list) => list.id === menu.listId) : undefined;

  function renderRows(items: readonly SocialList[]) {
    return items.map((list) => (
      <CollectionRow
        key={list.id}
        list={list}
        selected={selectedId === list.id}
        menuOpen={menu?.listId === list.id}
        onSelect={onSelect}
        onOpenMenu={(anchor) => setMenu({ listId: list.id, anchor })}
      />
    ));
  }

  function pick(id: string) {
    const list = menuList;
    setMenu(null);
    if (!list) return;
    if (id === "edit") onEdit(list);
    else if (id === "delete") onDelete(list);
  }

  return (
    <nav className="audience-sidebar" aria-label={t("Audience lists")}>
      <ul className="audience-list">
        <ActionHost as="li" selected={selectedId === null} className="audience-collection-row">
          <Button
            variant="item"
            size="sm"
            selected={selectedId === null}
            className="audience-collection-main"
            startIcon={<UserRound className="icon-sm" aria-hidden="true" />}
            aria-current={selectedId === null ? "true" : undefined}
            onClick={() => onSelect(null)}
          >
            {t("All people")}
          </Button>
        </ActionHost>
      </ul>
      <SectionLabel
        labelId="audience-lists-heading"
        actions={
          <Button variant="ghost" size="sm" iconOnly label={t("New list")} onClick={onNewList}>
            <Plus className="icon-sm" aria-hidden="true" />
          </Button>
        }
      >
        {t("Lists")}
      </SectionLabel>
      {statics.length ? (
        <ul className="audience-list" aria-labelledby="audience-lists-heading">
          {renderRows(statics)}
        </ul>
      ) : (
        <EmptyState
          size="inline"
          context="list"
          description={t("No lists yet. A list holds people you choose.")}
        />
      )}
      <SectionLabel
        labelId="audience-segments-heading"
        actions={
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            label={t("New segment")}
            onClick={onNewSegment}
          >
            <Plus className="icon-sm" aria-hidden="true" />
          </Button>
        }
      >
        {t("Segments")}
      </SectionLabel>
      {segments.length ? (
        <ul className="audience-list" aria-labelledby="audience-segments-heading">
          {renderRows(segments)}
        </ul>
      ) : (
        <EmptyState
          size="inline"
          context="list"
          description={t("No segments yet. A segment collects everyone who matches conditions.")}
        />
      )}
      {menu && menuList ? (
        <DropdownMenu
          anchor={menu.anchor}
          label={t("Actions for {p0}", { p0: listDisplayName(menuList) })}
          width={248}
          items={menuItems(menuList)}
          onPick={pick}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </nav>
  );
}
