import { useMemo } from "react";
import { formatNumber, t } from "../../../../shared/i18n";
import { Badge } from "../../../../shared/ui/Badge";
import { Timestamp } from "../../../../shared/ui/Timestamp";
import { Button } from "../../../../shared/ui/Button";
import { CollectionFooter } from "../../../../shared/ui/ContinuousList";
import { SortableDataTable, type DataColumn } from "../../../../shared/ui/SortableDataTable";
import { Meter } from "../../../../shared/ui/Meter";
import { OverflowTooltip } from "../../../../shared/ui/Tooltip";
import type { SocialPerson } from "../../model/audience";
import { stageLabel, stageTone, visibleTags } from "./audienceModel";
import { PlatformMarks } from "../common/PlatformIcon";
import { SocialAvatar } from "../common/SocialAvatar";
import "./audience.css";

export type PeopleTableProps = {
  people: readonly SocialPerson[];
  selected: ReadonlySet<string>;
  activePersonId?: string;
  hasMore: boolean;
  loadingMore: boolean;
  onToggle: (personId: string) => void;
  onToggleAll: (personIds: readonly string[], checked: boolean) => void;
  onOpen: (personId: string) => void;
  onLoadMore: () => void;
};

/** Date-only "Updated" caption (year only when it is not the current one); the full time is the title. */
function UpdatedDate({ value }: { value: number }) {
  return <Timestamp className="audience-caption audience-nowrap" value={value} format="date" />;
}

type PersonRow = { id: string; name: string; person: SocialPerson };

function PersonCell({ person, onOpen }: { person: SocialPerson; onOpen: (id: string) => void }) {
  const handle = person.handles.find((item) => item.username)?.username;
  const caption = handle ? `@${handle.replace(/^@/, "")}` : person.emails[0]?.address;
  return (
    <div className="audience-person">
      <SocialAvatar name={person.name} size="sm" />
      <div className="audience-person-text">
        <OverflowTooltip label={person.name}>
          <Button variant="link" size="sm" onClick={() => onOpen(person.id)}>
            {person.name}
          </Button>
        </OverflowTooltip>
        {caption ? (
          <OverflowTooltip label={caption}>
            <span className="audience-caption audience-ellipsis">{caption}</span>
          </OverflowTooltip>
        ) : null}
      </div>
    </div>
  );
}

function AccountsCell({ person }: { person: SocialPerson }) {
  const platforms = [...new Set(person.handles.map((handle) => handle.platform))];
  return platforms.length ? (
    <PlatformMarks platforms={platforms} size="xs" />
  ) : (
    <span className="audience-caption">{t("No account")}</span>
  );
}

function ScoreCell({ person }: { person: SocialPerson }) {
  return person.score ? (
    <span className="audience-score">
      <Meter
        className="audience-score-bar"
        label={t("Interest score")}
        value={person.score.value}
        tone="accent"
      />
      {formatNumber(person.score.value)}
    </span>
  ) : (
    "–"
  );
}

function TagsCell({ person }: { person: SocialPerson }) {
  const tags = visibleTags(person.tags);
  return (
    <span className="audience-badges">
      {tags.shown.map((tag) => (
        <Badge key={tag} size="xs" tone="neutral">
          {tag}
        </Badge>
      ))}
      {tags.hidden > 0 ? (
        <Badge size="xs" tone="neutral">
          {t("+{p0}", { p0: tags.hidden })}
        </Badge>
      ) : null}
    </span>
  );
}

/** Compact people table. Rows open the person panel; checkboxes select for bulk actions. */
export function PeopleTable({
  people,
  selected,
  activePersonId,
  hasMore,
  loadingMore,
  onToggle,
  onToggleAll,
  onOpen,
  onLoadMore,
}: PeopleTableProps) {
  const rows = useMemo<PersonRow[]>(
    () => people.map((person) => ({ id: person.id, name: person.name, person })),
    [people],
  );
  const columns = useMemo<DataColumn<PersonRow>[]>(
    () => [
      {
        key: "name",
        label: t("Name"),
        sortable: false,
        render: (_, row) => <PersonCell person={row.person} onOpen={onOpen} />,
      },
      {
        key: "accounts",
        label: t("Accounts"),
        sortable: false,
        hideBelow: "sm",
        render: (_, row) => <AccountsCell person={row.person} />,
      },
      {
        key: "stage",
        label: t("Status"),
        sortable: false,
        render: (_, row) => (
          <Badge size="sm" tone={stageTone(row.person.stage)}>
            {stageLabel(row.person.stage)}
          </Badge>
        ),
      },
      {
        key: "score",
        label: t("Score"),
        sortable: false,
        numeric: true,
        hideBelow: "md",
        render: (_, row) => <ScoreCell person={row.person} />,
      },
      {
        key: "tags",
        label: t("Tags"),
        sortable: false,
        hideBelow: "md",
        render: (_, row) => <TagsCell person={row.person} />,
      },
      {
        key: "updatedAt",
        label: t("Updated"),
        sortable: false,
        render: (_, row) => <UpdatedDate value={row.person.updatedAt} />,
      },
    ],
    [onOpen],
  );
  // The table reports the whole selection; translate it into the per-person calls the screen uses.
  const onSelectionChange = (keys: string[]) => {
    const next = new Set(keys);
    const added = people.filter((p) => next.has(p.id) && !selected.has(p.id)).map((p) => p.id);
    const removed = people.filter((p) => !next.has(p.id) && selected.has(p.id)).map((p) => p.id);
    if (added.length === 1 && !removed.length) onToggle(added[0]!);
    else if (removed.length === 1 && !added.length) onToggle(removed[0]!);
    else if (added.length) onToggleAll(added, true);
    else if (removed.length) onToggleAll(removed, false);
  };
  return (
    <SortableDataTable
      rows={rows}
      columns={columns}
      rowKey="id"
      caption={t("People")}
      scrollKey="social:people"
      selectable
      selectedKeys={[...selected]}
      onSelectionChange={onSelectionChange}
      selectAllLabel={t("Select all people on this page")}
      rowLabel={(row) => t("Select {p0}", { p0: row.name })}
      selectionFooter={false}
      onRowActivate={(key) => onOpen(key)}
      activeKey={activePersonId}
      footer={
        hasMore ? (
          <CollectionFooter
            standalone
            hasMore
            onLoadMore={onLoadMore}
            loadMoreLabel={t("Load more people")}
            loadMoreButtonProps={{ variant: "secondary", loading: loadingMore }}
          />
        ) : null
      }
    />
  );
}
