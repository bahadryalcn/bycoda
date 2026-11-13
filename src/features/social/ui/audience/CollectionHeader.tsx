import { t } from "../../../../shared/i18n";
import { Badge } from "../../../../shared/ui/Badge";
import { Button } from "../../../../shared/ui/Button";
import { Heading } from "../../../../shared/ui/Heading";
import { Pencil, Trash2 } from "../../../../shared/ui/icons";
import { Text } from "../../../../shared/ui/Text";
import type { SocialList } from "../../model/audience";
import { collectionKind, filterSummary, listDisplayName } from "./audienceModel";
import "./audience.css";

export type CollectionHeaderProps = {
  /** The open list or segment; undefined means everyone. */
  list: SocialList | undefined;
  onEdit: (list: SocialList) => void;
  onDelete: (list: SocialList) => void;
};

/** One line of plain words about what the open collection holds and how it is filled. */
function collectionSummary(list: SocialList | undefined): string {
  if (!list) return t("Everyone you collected, imported or added.");
  const kind = collectionKind(list);
  if (kind === "commenters")
    return t("Filled by the Commenters rule. It cannot be renamed or deleted.");
  if (kind === "list") return t("People you add by hand or with a capture rule.");
  const parts = filterSummary(list.filter);
  return parts.length
    ? t("Updates by itself. People who match all of: {p0}.", { p0: parts.join("; ") })
    : t("Updates by itself as people change.");
}

/** Title block above the people table: which collection is open, what kind it is, and its actions. */
export function CollectionHeader({ list, onEdit, onDelete }: CollectionHeaderProps) {
  const kind = list ? collectionKind(list) : undefined;
  const kindLabel =
    kind === "segment"
      ? t("Segment")
      : kind === "commenters"
        ? t("Automatic list")
        : kind === "list"
          ? t("List")
          : undefined;
  return (
    <header className="audience-collection-head">
      <div className="audience-collection-title">
        <Heading as="h2" size="section" truncate>
          {list ? listDisplayName(list) : t("All people")}
        </Heading>
        {kindLabel ? (
          <Badge size="sm" tone="neutral">
            {kindLabel}
          </Badge>
        ) : null}
        {list && kind !== "commenters" ? (
          <span className="audience-collection-actions">
            <Button
              variant="ghost"
              size="sm"
              startIcon={<Pencil className="icon-sm" aria-hidden="true" />}
              onClick={() => onEdit(list)}
            >
              {kind === "segment" ? t("Edit segment") : t("Rename")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              tone="danger"
              startIcon={<Trash2 className="icon-sm" aria-hidden="true" />}
              onClick={() => onDelete(list)}
            >
              {t("Delete")}
            </Button>
          </span>
        ) : null}
      </div>
      <Text as="p" tone="secondary" leading="snug" className="audience-muted">
        {collectionSummary(list)}
      </Text>
    </header>
  );
}
