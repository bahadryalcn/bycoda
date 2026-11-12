import { Text } from "../../../../shared/ui/Text";
import { useMemo, useState } from "react";
import { formatDate, t } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";
import { ChevronLeft, ChevronRight, Plus } from "../../../../shared/ui/icons";
import { InlineMessage } from "../../../../shared/ui/InlineError";
import { SegmentedControl } from "../../../../shared/ui/SegmentedControl";
import { useSocialMediaEditor } from "../../hooks/useSocialMediaEditor";
import type { SocialCampaign } from "../../model/social";
import { EmptyHint } from "../common/EmptyHint";
import { DisabledReason, gateProps, type ActionGate } from "../common/DisabledReason";
import { postHasLockingJob } from "./contentGate";
import type { SocialScreenProps } from "../shell/screens";
import { ContentCalendar } from "./ContentCalendar";
import { ContentEditor, type EditorOutcome } from "./ContentEditor";
import { ContentList, type ContentListStatus } from "./ContentList";
import {
  calendarEntries,
  dayKey,
  monthCells,
  shiftMonth,
  shiftWeek,
  weekDays,
  type CalendarView,
} from "./calendarModel";
import { draftFromCampaign, emptyDraft, type ContentDraft } from "./contentDraft";
import { useContentData } from "./useContentData";
import "./content.css";

const OUTCOME_TEXT: Record<EditorOutcome, () => string> = {
  published: () => t("Posts are being published. Follow the results in this calendar."),
  scheduled: () => t("Posts scheduled. Follow the results in this calendar."),
  draft: () => t("Draft saved."),
  program: () => t("Repeating program saved as paused. Review it before it starts."),
};

/** A draft with words or media that is not saved as a campaign yet. */
function hasUnsaved(draft: ContentDraft): boolean {
  return !draft.campaignId && (draft.text.trim() !== "" || draft.media.length > 0);
}

/** Content: calendar or list of posts, and one editor for new and saved posts. */
export function ContentScreen({
  client,
  projectId,
  shellState,
  active,
  onNavigate,
}: SocialScreenProps) {
  const data = useContentData(client, projectId, active);
  const editor = useSocialMediaEditor(client);
  const [view, setView] = useState<CalendarView>("week");
  const [anchor, setAnchor] = useState(() => Date.now());
  const [accountFilter, setAccountFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<ContentListStatus>("all");
  const [draft, setDraft] = useState<ContentDraft>(emptyDraft);
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "warning"; text: string }>();
  const snapshot = data.snapshot;
  const accounts = snapshot?.accounts ?? [];
  const entries = useMemo(
    () => calendarEntries(snapshot?.jobs ?? [], accounts),
    [snapshot, accounts],
  );
  const newGate: ActionGate = !projectId
    ? { disabled: true, disabledReason: t("Choose a project first.") }
    : !snapshot
      ? { disabled: true, disabledReason: t("Loading accounts…") }
      : { disabled: false };
  const lockedReason =
    draft.campaignId && postHasLockingJob(draft.campaignId, snapshot?.jobs ?? [])
      ? t("This post was already scheduled or sent, so it can't be edited here.")
      : undefined;

  const openNew = (day?: number) => {
    setNotice(undefined);
    if (!hasUnsaved(draft)) {
      setDraft(
        day === undefined
          ? emptyDraft()
          : { ...emptyDraft(), when: "later", scheduledAt: `${dayKey(day)}T09:00` },
      );
    }
    setOpen(true);
  };
  const openCampaign = (campaign: SocialCampaign) => {
    if (hasUnsaved(draft)) {
      setNotice({
        tone: "warning",
        text: t("Finish the post you are writing first, or discard it."),
      });
      return;
    }
    setNotice(undefined);
    setDraft(draftFromCampaign(campaign));
    setOpen(true);
  };
  const close = () => {
    setOpen(false);
    // A saved post is read from the Host again on the next open; only new drafts are kept.
    if (draft.campaignId) setDraft(emptyDraft());
  };
  // The Host saved the post before a later publish step could fail: later saves revise it, not copy it.
  const saved = (identity: { campaignId: string; revision: number }) =>
    setDraft((current) => ({
      ...current,
      campaignId: identity.campaignId,
      revision: identity.revision,
    }));
  const done = (outcome: EditorOutcome) => {
    setOpen(false);
    setDraft(emptyDraft());
    setNotice({ tone: "success", text: OUTCOME_TEXT[outcome]() });
    data.refetch();
  };

  const isEmpty = !!snapshot && snapshot.campaigns.length === 0 && data.programs.length === 0;
  const days = view === "week" ? weekDays(anchor) : monthCells(anchor);
  const shift = (step: number) =>
    setAnchor((value) => (view === "week" ? shiftWeek(value, step) : shiftMonth(value, step)));
  const rangeLabel =
    view === "week"
      ? `${formatDate(days[0]!, { day: "numeric", month: "short" })} – ${formatDate(days[6]!, { day: "numeric", month: "short" })}`
      : formatDate(anchor, { month: "long", year: "numeric" });

  return (
    <section className="content-screen">
      {!isEmpty ? (
        <div className="content-toolbar">
          {projectId && !data.error && !data.loading ? (
            <SegmentedControl
              label={t("View")}
              selectionRole="radio"
              value={view}
              options={[
                { value: "week", label: t("Week") },
                { value: "month", label: t("Month") },
                { value: "list", label: t("List") },
              ]}
              onValueChange={(value) => setView(value as CalendarView)}
            />
          ) : null}
          {projectId && !data.error && !data.loading && view !== "list" ? (
            <div className="content-range">
              <Button
                variant="ghost"
                size="sm"
                iconOnly
                label={t("Previous")}
                onClick={() => shift(-1)}
              >
                <ChevronLeft className="icon-sm" aria-hidden />
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setAnchor(Date.now())}>
                {t("Today")}
              </Button>
              <Button variant="ghost" size="sm" iconOnly label={t("Next")} onClick={() => shift(1)}>
                <ChevronRight className="icon-sm" aria-hidden />
              </Button>
              <Text
                size="secondary"
                tone="secondary"
                leading="inherit"
                className="content-range-label"
              >
                {rangeLabel}
              </Text>
            </div>
          ) : null}
          <span className="content-toolbar-primary">
            <DisabledReason
              variant="primary"
              size="sm"
              startIcon={<Plus className="icon-sm" aria-hidden />}
              onClick={() => openNew()}
              {...gateProps(newGate)}
            >
              {t("New post")}
            </DisabledReason>
          </span>
        </div>
      ) : null}
      {notice ? (
        <InlineMessage tone={notice.tone === "success" ? "success" : "warning"}>
          {notice.text}
        </InlineMessage>
      ) : null}
      {!projectId ? (
        <EmptyHint message={t("Choose a project at the top to see its posts.")} />
      ) : data.error ? (
        <InlineMessage tone="danger" retry={{ onRetry: data.refetch, label: t("Try again") }}>
          {t("Could not load posts.")}
        </InlineMessage>
      ) : data.loading ? (
        <Text
          as="p"
          size="caption"
          tone="muted"
          leading="inherit"
          className="content-platform-note"
        >
          {t("Loading…")}
        </Text>
      ) : isEmpty ? (
        <EmptyHint
          message={t("No posts yet.")}
          action={{ label: t("New post"), onClick: () => openNew(), ...newGate }}
          fillWithAi={{
            onClick: () => onNavigate("command", { prompt: t("Plan this week's posts") }),
          }}
        />
      ) : (
        <>
          {view === "list" ? (
            <ContentList
              campaigns={snapshot?.campaigns ?? []}
              jobs={snapshot?.jobs ?? []}
              accounts={accounts}
              programs={data.programs}
              accountFilter={accountFilter}
              statusFilter={statusFilter}
              onAccountFilter={setAccountFilter}
              onStatusFilter={setStatusFilter}
              onOpen={(campaignId) => {
                const campaign = snapshot?.campaigns.find((item) => item.id === campaignId);
                if (campaign) openCampaign(campaign);
              }}
            />
          ) : (
            <ContentCalendar
              view={view}
              anchor={anchor}
              entries={entries}
              onPickDay={(day) => openNew(day)}
              onOpen={(campaignId) => {
                const campaign = snapshot?.campaigns.find((item) => item.id === campaignId);
                if (campaign) openCampaign(campaign);
              }}
            />
          )}
        </>
      )}
      {open && projectId ? (
        <ContentEditor
          client={client}
          editor={editor}
          snapshot={snapshot}
          projectId={projectId}
          shell={shellState}
          draft={draft}
          onDraft={setDraft}
          locked={lockedReason}
          onSaved={saved}
          onDone={done}
          onClose={close}
          onNavigate={onNavigate}
        />
      ) : null}
    </section>
  );
}
