import { useRef, useState } from "react";
import { formatNumber, t } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";
import { useConfirm } from "../../../../shared/ui/ConfirmDialog";
import { DropdownMenu } from "../../../../shared/ui/DropdownMenu";
import { InlineError, InlineMessage } from "../../../../shared/ui/InlineError";
import { SearchInput } from "../../../../shared/ui/SearchInput";
import { TabList, TabPanel, Tabs } from "../../../../shared/ui/Tabs";
import { MoreHorizontal } from "../../../../shared/ui/icons";
import type { SocialPerson } from "../../model/audience";
import type { SocialScreenProps } from "../shell/screens";
import { DisabledReason, type ActionGate } from "../common/DisabledReason";
import { EmptyHint } from "../common/EmptyHint";
import { BulkBar } from "./BulkBar";
import { CaptureRules } from "./CaptureRules";
import { BulkDialog, type BulkAction } from "./BulkDialogs";
import { FindPeopleDialog } from "./FindPeopleDialog";
import { ImportDialog } from "./ImportDialog";
import { ListDialog } from "./ListDialog";
import { ListsSidebar } from "./ListsSidebar";
import { OutreachBoard } from "./OutreachBoard";
import { PeopleTable } from "./PeopleTable";
import { PersonPanel } from "./PersonPanel";
import { SegmentBuilder } from "./SegmentBuilder";
import { removeFromList, suppressPeople } from "./audienceBulk";
import { errorMessage } from "./audienceModel";
import { useAudienceData } from "./useAudienceData";
import "./audience.css";

type AudienceSection = "people" | "rules" | "outreach";
type Dialog =
  | { kind: "find" }
  | { kind: "import" }
  | { kind: "newList" }
  | { kind: "segment" }
  | { kind: "bulk"; action: BulkAction };

/** Audience: who you reach, the lists they belong to, the rules that collect them and the outreach sequences. */
export function AudienceScreen({ client, onNavigate, projectId }: SocialScreenProps) {
  const [section, setSection] = useState<AudienceSection>("people");
  const [listId, setListId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [activePersonId, setActivePersonId] = useState<string>();
  const [dialog, setDialog] = useState<Dialog>();
  const [notice, setNotice] = useState<string>();
  const [noticeTone, setNoticeTone] = useState<"success" | "warning">("success");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [aiBusy, setAiBusy] = useState(false);
  const [aiSteps, setAiSteps] = useState<number>();
  const moreButton = useRef<HTMLButtonElement>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const { confirm, dialog: confirmDialog } = useConfirm();
  const data = useAudienceData(client, { listId, query });

  const activeList = data.lists.find((list) => list.id === listId);
  const selectedIds = [...selected];
  const people: SocialPerson[] = data.people;

  function selectList(next: string | null) {
    setListId(next);
    setSelected(new Set());
    setActivePersonId(undefined);
  }

  function toggle(personId: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(personId)) next.delete(personId);
      else next.add(personId);
      return next;
    });
  }

  function toggleAll(personIds: readonly string[], checked: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      for (const id of personIds) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  async function fillWithAi() {
    setAiBusy(true);
    setError(undefined);
    try {
      const plan = await client.ai.command({
        text: t("Find people who commented on my recent posts and add them to Commenters"),
        projectId,
      });
      setAiSteps(plan.steps.length);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setAiBusy(false);
    }
  }

  async function removeSelectedFromList() {
    if (!activeList || activeList.kind !== "static" || bulkBusy) return;
    const ok = await confirm({
      title: t("Remove from this list?"),
      message: t("The selected people stay in your audience and in any other list."),
      confirmLabel: t("Remove"),
      danger: true,
    });
    if (!ok) return;
    setBulkBusy(true);
    setError(undefined);
    try {
      const changed = await removeFromList(client, activeList.id, selectedIds);
      setNoticeTone("success");
      setNotice(t("{p0} removed from {p1}", { p0: formatNumber(changed), p1: activeList.name }));
      setSelected(new Set());
      data.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBulkBusy(false);
    }
  }

  async function optOutSelected() {
    if (bulkBusy) return;
    const ok = await confirm({
      title: t("Stop contacting these people?"),
      message: t("They will not be sent any message on any channel. Nothing is deleted."),
      confirmLabel: t("Opt out"),
      danger: true,
    });
    if (!ok) return;
    setBulkBusy(true);
    setError(undefined);
    try {
      const result = await suppressPeople(client, selectedIds);
      setNoticeTone(result.failed.length ? "warning" : "success");
      setNotice(
        t("{p0} people opted out, {p1} could not be updated", {
          p0: formatNumber(result.done),
          p1: formatNumber(result.failed.length),
        }),
      );
      setSelected(new Set());
      data.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBulkBusy(false);
    }
  }

  const noAccounts = data.accounts.length === 0;
  const findReason = noAccounts ? t("Connect an account in Accounts & Settings first.") : undefined;
  const findState = findReason
    ? { disabled: true as const, reason: findReason }
    : { disabled: false as const };
  const findGate: ActionGate = noAccounts
    ? { disabled: true, disabledReason: t("Connect an account in Accounts & Settings first.") }
    : { disabled: false };
  const fillGate: ActionGate = noAccounts
    ? { disabled: true, disabledReason: t("Connect an account in Accounts & Settings first.") }
    : aiBusy
      ? { disabled: true, disabledReason: t("Wait for the current operation to finish") }
      : { disabled: false };
  const menuItems = [
    { kind: "item" as const, id: "import", label: t("Import people…") },
    { kind: "item" as const, id: "newList", label: t("New list…") },
    { kind: "item" as const, id: "segment", label: t("New segment…") },
  ];
  const bulkItems = [
    { kind: "item" as const, id: "list", label: t("Add to list…") },
    { kind: "item" as const, id: "tag", label: t("Add a tag…") },
    { kind: "item" as const, id: "sequence", label: t("Add to sequence…") },
    ...(activeList?.kind === "static"
      ? [{ kind: "item" as const, id: "remove", label: t("Remove from this list") }]
      : []),
    { kind: "item" as const, id: "optout", label: t("Stop contacting…"), danger: true },
  ];

  function pickBulk(id: string) {
    if (id === "list" || id === "tag" || id === "sequence") setDialog({ kind: "bulk", action: id });
    else if (id === "remove") void removeSelectedFromList().catch(() => undefined);
    else if (id === "optout")
      void optOutSelected().catch((err: unknown) => setError(errorMessage(err)));
  }

  function pickMore(id: string) {
    setMoreOpen(false);
    if (id === "import") setDialog({ kind: "import" });
    else if (id === "newList") setDialog({ kind: "newList" });
    else if (id === "segment") setDialog({ kind: "segment" });
  }

  const emptyPeople = !data.loading && !data.error && !people.length && !query && !listId;

  return (
    <section className="audience-screen" aria-label={t("Audience")}>
      <Tabs value={section} onValueChange={setSection}>
        <div className="audience-toolbar">
          <TabList
            label={t("Audience sections")}
            items={[
              { value: "people", label: t("People") },
              { value: "rules", label: t("Capture rules") },
              { value: "outreach", label: t("Outreach") },
            ]}
          />
          {section === "people" ? (
            <div className="audience-row">
              <DisabledReason
                variant="primary"
                size="sm"
                {...findState}
                onClick={() => setDialog({ kind: "find" })}
              >
                {t("Find people")}
              </DisabledReason>
              <Button
                ref={moreButton}
                variant="ghost"
                size="sm"
                iconOnly
                label={t("More actions")}
                aria-haspopup="menu"
                aria-expanded={moreOpen}
                onClick={() => setMoreOpen((open) => !open)}
              >
                <MoreHorizontal className="icon-sm" aria-hidden="true" />
              </Button>
              {moreOpen ? (
                <DropdownMenu
                  anchor={moreButton}
                  label={t("More actions")}
                  returnFocusRef={moreButton}
                  onClose={() => setMoreOpen(false)}
                  items={menuItems}
                  onPick={pickMore}
                />
              ) : null}
            </div>
          ) : null}
        </div>

        {notice ? <InlineMessage tone={noticeTone}>{notice}</InlineMessage> : null}
        {error ? <InlineError>{error}</InlineError> : null}

        <TabPanel value="people">
          <div className="audience-layout">
            <ListsSidebar
              lists={data.lists}
              selectedId={listId}
              onSelect={selectList}
              onNewList={() => setDialog({ kind: "newList" })}
              onNewSegment={() => setDialog({ kind: "segment" })}
            />
            <div className="audience-main">
              <div className="audience-row">
                <SearchInput
                  containerClassName="audience-search"
                  appearance="field"
                  aria-label={t("Search people")}
                  placeholder={t("Search by name")}
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setSelected(new Set());
                  }}
                  clearable
                />
              </div>
              {selected.size ? (
                <BulkBar
                  count={selected.size}
                  items={bulkItems}
                  onClear={() => setSelected(new Set())}
                  onPick={pickBulk}
                  disabled={bulkBusy}
                />
              ) : null}

              {data.loading && !people.length ? (
                <p className="audience-muted">{t("Loading people…")}</p>
              ) : null}
              {data.error ? (
                <InlineError retry={{ onRetry: data.reload, label: t("Try again") }}>
                  {data.error}
                </InlineError>
              ) : null}
              {emptyPeople ? (
                <EmptyHint
                  message={t(
                    "No people yet. Find people who engage with your posts, or import a list.",
                  )}
                  action={{
                    label: t("Find people"),
                    onClick: () => setDialog({ kind: "find" }),
                    ...findGate,
                  }}
                  fillWithAi={{
                    onClick: () => void fillWithAi().catch(() => undefined),
                    ...fillGate,
                  }}
                />
              ) : null}
              {aiSteps !== undefined ? (
                <InlineMessage tone="info">
                  {t("AI prepared {p0} steps. Review them in Command before anything runs.", {
                    p0: aiSteps,
                  })}{" "}
                  <Button variant="link" size="sm" onClick={() => onNavigate("command")}>
                    {t("Open Command")}
                  </Button>
                </InlineMessage>
              ) : null}
              {!emptyPeople && !data.error && !(data.loading && !people.length) ? (
                people.length ? (
                  <PeopleTable
                    people={people}
                    selected={selected}
                    activePersonId={activePersonId}
                    hasMore={data.hasMore}
                    loadingMore={data.loadingMore}
                    onToggle={toggle}
                    onToggleAll={toggleAll}
                    onOpen={setActivePersonId}
                    onLoadMore={data.loadMore}
                  />
                ) : (
                  <EmptyHint message={t("No one matches this list or search.")} />
                )
              ) : null}
            </div>
          </div>
        </TabPanel>

        <TabPanel value="rules">
          <CaptureRules
            client={client}
            accounts={data.accounts}
            lists={data.lists}
            onChanged={data.reload}
          />
        </TabPanel>

        <TabPanel value="outreach">
          <OutreachBoard client={client} lists={data.lists} onChanged={data.reload} />
        </TabPanel>
      </Tabs>

      {activePersonId ? (
        <PersonPanel
          key={activePersonId}
          client={client}
          personId={activePersonId}
          onClose={() => setActivePersonId(undefined)}
          onChanged={data.patchPerson}
          onDeleted={(personId) => {
            data.removePeople([personId]);
            setActivePersonId(undefined);
          }}
          onMerged={() => data.reload()}
        />
      ) : null}

      {dialog?.kind === "find" ? (
        <FindPeopleDialog
          client={client}
          accounts={data.accounts}
          lists={data.lists}
          onClose={() => setDialog(undefined)}
          onCollected={(result) => {
            setNoticeTone("success");
            setNotice(
              result.unsupported
                ? undefined
                : t("{p0} people added, {p1} skipped", {
                    p0: formatNumber(result.collected),
                    p1: formatNumber(result.skipped),
                  }),
            );
            data.reload();
          }}
        />
      ) : null}
      {dialog?.kind === "import" ? (
        <ImportDialog
          client={client}
          accounts={data.accounts}
          lists={data.lists}
          onClose={() => setDialog(undefined)}
          onImported={() => data.reload()}
        />
      ) : null}
      {dialog?.kind === "newList" ? (
        <ListDialog
          client={client}
          onClose={() => setDialog(undefined)}
          onCreated={(list) => {
            selectList(list.id);
            data.reload();
          }}
        />
      ) : null}
      {dialog?.kind === "segment" ? (
        <SegmentBuilder
          client={client}
          onClose={() => setDialog(undefined)}
          onCreated={(list) => {
            selectList(list.id);
            data.reload();
          }}
        />
      ) : null}
      {dialog?.kind === "bulk" ? (
        <BulkDialog
          client={client}
          action={dialog.action}
          people={people.filter((person) => selected.has(person.id))}
          lists={data.lists}
          onClose={() => setDialog(undefined)}
          onDone={() => data.reload()}
        />
      ) : null}
      {confirmDialog}
    </section>
  );
}
