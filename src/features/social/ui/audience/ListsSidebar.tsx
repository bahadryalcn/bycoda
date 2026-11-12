import { Text } from "../../../../shared/ui/Text";
import { t } from "../../../../shared/i18n";
import { Badge } from "../../../../shared/ui/Badge";
import { Button } from "../../../../shared/ui/Button";
import { ListBullet, ListFilter, Plus, UserRound } from "../../../../shared/ui/icons";
import { SectionLabel } from "../../../../shared/ui/SectionLabel";
import type { SocialList } from "../../model/audience";
import { isCommentersList } from "./audienceModel";
import "./audience.css";

export type ListsSidebarProps = {
  lists: readonly SocialList[];
  /** null means "All people". */
  selectedId: string | null;
  onSelect: (listId: string | null) => void;
  onNewList: () => void;
  onNewSegment: () => void;
};

function listItem(
  list: SocialList,
  selectedId: string | null,
  onSelect: (listId: string | null) => void,
) {
  const current = selectedId === list.id;
  return (
    <li key={list.id}>
      <Button
        variant="item"
        size="sm"
        startIcon={
          list.kind === "dynamic" && !isCommentersList(list) ? (
            <ListFilter className="icon-sm" aria-hidden="true" />
          ) : (
            <ListBullet className="icon-sm" aria-hidden="true" />
          )
        }
        aria-current={current ? "true" : undefined}
        onClick={() => onSelect(list.id)}
      >
        <Text
          size="inherit"
          tone="inherit"
          leading="inherit"
          truncate
          className="audience-list-name"
        >
          {isCommentersList(list) ? t("Commenters") : list.name}
        </Text>
        {isCommentersList(list) ? (
          <Badge size="xs" tone="neutral">
            {t("Automatic")}
          </Badge>
        ) : null}
      </Button>
    </li>
  );
}

/** Left column: everyone, static lists (the system Commenters list included), dynamic segments and the two creation actions. */
export function ListsSidebar({
  lists,
  selectedId,
  onSelect,
  onNewList,
  onNewSegment,
}: ListsSidebarProps) {
  const statics = lists.filter((list) => list.kind === "static" || isCommentersList(list));
  const segments = lists.filter((list) => list.kind === "dynamic" && !isCommentersList(list));
  return (
    <nav className="audience-sidebar" aria-label={t("Audience lists")}>
      <ul className="audience-list">
        <li>
          <Button
            variant="item"
            size="sm"
            startIcon={<UserRound className="icon-sm" aria-hidden="true" />}
            aria-current={selectedId === null ? "true" : undefined}
            onClick={() => onSelect(null)}
          >
            {t("All people")}
          </Button>
        </li>
      </ul>
      <SectionLabel>{t("Lists")}</SectionLabel>
      <ul className="audience-list">
        {statics.map((list) => listItem(list, selectedId, onSelect))}
      </ul>
      <Button
        variant="ghost"
        size="sm"
        className="audience-add"
        startIcon={<Plus className="icon-sm" aria-hidden="true" />}
        onClick={onNewList}
      >
        {t("New list")}
      </Button>
      <SectionLabel>{t("Segments")}</SectionLabel>
      <ul className="audience-list">
        {segments.map((list) => listItem(list, selectedId, onSelect))}
      </ul>
      <Button
        variant="ghost"
        size="sm"
        className="audience-add"
        startIcon={<Plus className="icon-sm" aria-hidden="true" />}
        onClick={onNewSegment}
      >
        {t("New segment")}
      </Button>
    </nav>
  );
}
