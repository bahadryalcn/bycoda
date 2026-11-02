import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { Button } from "../../../shared/ui/Button";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { getLocale, t, useLocale } from "../../../shared/i18n";
import { useContext, useRef, useState } from "react";
import { SocialBusyContext, SocialPanelActiveContext } from "./socialContext";
import { Badge } from "../../../shared/ui/Badge";
import { BadgeList } from "../../../shared/ui/BadgeList";
import { useSocialWorkspaceFilter } from "./useSocialWorkspaceFilter";
import { useQueryVisible } from "../../../shared/hooks/useQueryVisible";
import { SocialPrograms } from "./SocialPrograms";
import { SocialAssistant } from "./SocialAssistant";
import { ProductKnowledge } from "./ProductKnowledge";
import { CampaignComposer } from "./CampaignComposer";
import { CampaignDetail, CampaignListTools, campaignState, campaignStateLabel } from "./CampaignBrowser";
import { useQuery } from "@tanstack/react-query";
import type { SocialProgram } from "../model/socialProgram";
import { socialQueryScope } from "../model/socialQuery";
import type { SocialCampaign } from "../model/social";
import { Empty, Notice, StatusBadge, type Props } from "./socialShared";
import "./social-content.css";
export function Campaigns({
  client,
  snapshot,
  projects,
  initialProject,
  run,
  onFilterChange,
  accountIntent,
  projectIntent,
  programIntent: openProgram,
  machineLabel = t("This computer"),
  onOpenSettings,
}: Props & {
  accountIntent?: { accountId: string; token: number };
  projectIntent?: { projectId: string; token: number };
  /** One-shot request (from Today or an accepted AI proposal) to open a saved campaign. */
  programIntent?: { id: string; token: number };
  machineLabel?: string;
  onOpenSettings?: () => void;
}) {
  useLocale();
  const [view, setView] = useState<"manual" | "ai">("manual");
  const active = useContext(SocialPanelActiveContext);
  const socialLocked = useContext(SocialBusyContext);
  const visible = useQueryVisible();
  const programIntentToken = useRef(0);
  const [programIntent, setProgramIntent] = useState<{ id: string; token: number }>();
  const [seenOpenProgram, setSeenOpenProgram] = useState<number>();
  if (openProgram && openProgram.token !== seenOpenProgram) {
    setSeenOpenProgram(openProgram.token);
    setProgramIntent({ id: openProgram.id, token: -openProgram.token });
    setView("ai");
  }
  // An account intent from another section switches to writing once per token.
  const [seenAccountIntent, setSeenAccountIntent] = useState<number>();
  if (accountIntent && accountIntent.token !== seenAccountIntent) {
    setSeenAccountIntent(accountIntent.token);
    setView("manual");
  }
  const programsQuery = useQuery({
    queryKey: [...socialQueryScope(client), "programs", snapshot.programProjectId ?? ""],
    queryFn: () => client.request<SocialProgram[]>("programs.list", snapshot.programProjectId ? { projectId: snapshot.programProjectId } : {}),
    enabled: !!snapshot.programsSupported && active && visible,
    staleTime: 5_000,
    refetchInterval: active && visible ? 5_000 : false,
  });
  const [selectedId, setSelectedId] = useState(snapshot.campaigns[0]?.id ?? "");
  // Bumped to start a fresh check/approval whenever the selection or its saved content changes.
  const [detailEpoch, setDetailEpoch] = useState(0);
  const [editRequest, setEditRequest] = useState<{ campaign: SocialCampaign; version: number }>();
  // The campaign whose edit draft is parked in the composer until it is saved or stopped.
  const [parkedEdit, setParkedEdit] = useState<{ id: string; name: string }>();
  const [composerOpen, setComposerOpen] = useState(0);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const hostFiltered = useSocialWorkspaceFilter(
    snapshot,
    "campaigns",
    {
      query: search,
      status: statusFilter,
    },
    onFilterChange,
  );
  const selected = snapshot.campaigns.find((item) => item.id === selectedId);
  const selectedProgram =
    view === "ai" && programIntent
      ? programsQuery.data?.find((program) => program.id === programIntent.id && !program.cancelled)
      : undefined;
  const visibleCampaigns = snapshot.campaigns.filter(
    (campaign) =>
      hostFiltered ||
      (campaign.name
        .toLocaleLowerCase(getLocale())
        .includes(search.toLocaleLowerCase(getLocale())) &&
        (!statusFilter ||
          campaignState(campaign, snapshot.jobs, snapshot.campaignStates) === statusFilter)),
  );
  const showCampaignPreview = snapshot.campaigns.length > 0 || Boolean(search || statusFilter);
  const startEdit = (campaign: SocialCampaign) => {
    setView("manual");
    setParkedEdit({ id: campaign.id, name: campaign.name });
    setEditRequest((current) => ({ campaign, version: (current?.version ?? 0) + 1 }));
  };
  const selectedBlocked = snapshot.jobs.some(
    (job) =>
      job.campaignId === selected?.id &&
      ["queued", "running", "succeeded", "review"].includes(job.status),
  );
  const entry: "write" | "brief" | "edit" = view === "ai" ? "brief" : parkedEdit ? "edit" : "write";
  const canEditExisting = !parkedEdit ? !!selected && !selectedBlocked : true;
  const chooseEntry = (next: string) => {
    if (next === "brief") setView("ai");
    else if (next === "write") setView("manual");
    else if (parkedEdit && (!selected || selected.id === parkedEdit.id)) {
      // The parked edit draft keeps its unsaved changes; the form only reopens.
      setView("manual");
      setComposerOpen((current) => current + 1);
    } else if (selected && !selectedBlocked) startEdit(selected);
  };
  const projectItems = (ids: string[]) =>
    ids.map((id, index) => ({
      id: `${index}:${id}`,
      label: projects.find((project) => project.id === id)?.name || t("Project"),
    }));
  const parkedCampaign = parkedEdit
    ? snapshot.campaigns.find((campaign) => campaign.id === parkedEdit.id)
    : undefined;
  const programState = (program: SocialProgram) =>
    program.cancelled ? "cancelled" : program.enabled ? "active" : "paused";
  return (
    <div className="social-page social-campaign-page social-content-page">
      <header className="social-content-head">
      <SearchableSelect
        label={t("Loaded content")}
        value={view === "ai" && programIntent ? `program:${programIntent.id}` : selectedId ? `campaign:${selectedId}` : ""}
        placeholder={t("Choose content to open")}
        options={[
          ...visibleCampaigns.map((campaign) => ({ value: `campaign:${campaign.id}`, label: campaign.name, description: `${t("One-time content")} · ${campaignStateLabel(campaign, snapshot) ?? t(({ draft: "Draft", queued: "Scheduled", running: "Sending", succeeded: "Sent", partial: "Partially sent", failed: "Failed", review: "Needs review", paused: "Paused", cancelled: "Cancelled" } as Record<string, string>)[campaignState(campaign, snapshot.jobs, snapshot.campaignStates)] ?? "Draft")} · ${t("{p0} projects · {p1} accounts", { p0: campaign.projectIds.length, p1: campaign.variants.length })}` })),
          ...(programsQuery.data ?? []).map((program) => ({ value: `program:${program.id}`, label: program.name, description: `${t("Recurring content")} · ${program.enabled ? t("Active") : program.cancelled ? t("Cancelled") : t("Paused")}` })),
        ]}
        onChange={(value) => {
          if (value.startsWith("program:")) {
            setProgramIntent({ id: value.slice(8), token: ++programIntentToken.current });
            setView("ai");
          } else {
            setSelectedId(value.slice(9));
            setDetailEpoch((current) => current + 1);
            setView("manual");
          }
        }}
        searchLocale={getLocale()}
      />
      <SegmentedControl
        label={t("Content entry")}
        selectionRole="pressed"
        value={entry}
        onValueChange={chooseEntry}
        options={[
          { value: "write", label: t("Write"), disabled: !!parkedEdit },
          ...(snapshot.programsSupported
            ? [{ value: "brief", label: t("Generate from a brief") }]
            : []),
          { value: "edit", label: t("Edit existing"), disabled: socialLocked || !canEditExisting },
        ]}
      />
      </header>
      <div className="social-content-context" data-entry={entry}>
        <div className="social-content-context-main">
          {entry === "brief" ? (
            <>
              <strong>
                {selectedProgram?.name ??
                  (programIntent ? t("Recurring content") : t("New recurring content"))}
              </strong>
              {selectedProgram ? (
                <StatusBadge
                  status={programState(selectedProgram)}
                  label={
                    selectedProgram.cancelled
                      ? t("Cancelled")
                      : selectedProgram.enabled
                        ? t("Active")
                        : t("Paused")
                  }
                />
              ) : (
                <Badge appearance="subtle">{t("Not saved yet")}</Badge>
              )}
            </>
          ) : entry === "edit" ? (
            <>
              <strong>
                {t("Editing {p0}", { p0: parkedCampaign?.name ?? parkedEdit?.name ?? "" })}
              </strong>
              <Badge appearance="subtle">
                {t("Revision {p0}", {
                  p0:
                    (editRequest?.campaign.id === parkedEdit?.id
                      ? editRequest?.campaign.revision
                      : parkedCampaign?.revision) ?? 1,
                })}
              </Badge>
              {parkedCampaign ? (
                <>
                  <BadgeList
                    label={t("Projects")}
                    size="xs"
                    className="min-w-0 flex-[1_1_8rem]"
                    items={projectItems(parkedCampaign.projectIds)}
                  />
                  <StatusBadge
                    status={campaignState(parkedCampaign, snapshot.jobs, snapshot.campaignStates)}
                    label={campaignStateLabel(parkedCampaign, snapshot)}
                  />
                </>
              ) : null}
            </>
          ) : (
            <>
              <strong>{t("New campaign")}</strong>
              {selected ? (
                <span className="social-muted">
                  {t("Separate from {p0}", { p0: selected.name })}
                </span>
              ) : (
                <Badge appearance="subtle">{t("Not saved yet")}</Badge>
              )}
            </>
          )}
        </div>
        {entry === "write" && !selected && snapshot.campaigns.length ? (
          <span className="social-muted">{t("Select a saved campaign to edit it.")}</span>
        ) : null}
        <div className="social-content-actions" hidden={view !== "manual"}>
          <CampaignComposer
            client={client}
            snapshot={snapshot}
            projects={projects}
            initialProject={initialProject}
            run={run}
            accountIntent={accountIntent}
            editRequest={editRequest}
            openRequest={composerOpen}
            onEditingStop={() => setParkedEdit(undefined)}
            onSaved={(saved) => {
              setSelectedId(saved.id);
              setDetailEpoch((value) => value + 1);
            }}
          />
        </div>
      </div>
      {snapshot.pages?.campaigns?.total !== undefined && snapshot.pages.campaigns.total > snapshot.campaigns.length ? <p className="text-ui-caption text-(--ui-text-secondary)">{t("{p0} of {p1} one-time items loaded. Search or filter to find more content.", { p0: snapshot.campaigns.length, p1: snapshot.pages.campaigns.total })}</p> : null}
      {programsQuery.isLoading ? <p role="status" className="text-ui-caption">{t("Loading recurring content…")}</p> : null}
      {programsQuery.isError ? <Notice kind="error">{t("Recurring content could not be loaded. One-time content remains available.")} <Button variant="link" onClick={() => void programsQuery.refetch()} loading={programsQuery.isFetching}>{t("Retry")}</Button></Notice> : null}
      {snapshot.programsSupported ? (
        <SocialAssistant
          key={selectedProgram?.id ?? "new"}
          client={client}
          accounts={snapshot.accounts}
          projects={projects}
          profiles={snapshot.profiles}
          machineLabel={machineLabel}
          projectId={initialProject ?? ""}
          program={selectedProgram}
          run={run}
          collapsible
          onOpenProgram={(id) => {
            setProgramIntent({ id, token: ++programIntentToken.current });
            setView("ai");
          }}
          onOpenSettings={onOpenSettings}
        />
      ) : null}
      <div hidden={view !== "ai"}>
        <SocialPanelActiveContext.Provider value={active && view === "ai"}>
          <SocialPrograms {...{ client, snapshot, projects, initialProject, run }} collectionManaged selectionIntent={programIntent} onSelectionChange={(id) => setProgramIntent((current) => current?.id === id ? current : { id, token: ++programIntentToken.current })} />
        </SocialPanelActiveContext.Provider>
      </div>
      <div className="social-campaign-manual" hidden={view !== "manual"}>
        {snapshot.campaigns.length ? <div className="social-stats" aria-label={t("Campaign summary")}>
          <span>
            <strong>{snapshot.pages?.campaigns?.total ?? snapshot.campaigns.length}</strong>{" "}
            {t("campaigns")}
          </span>
          <span>
            <strong>
              {snapshot.campaignJobCounts?.queued ??
                snapshot.jobs.filter((job) => job.campaignId && job.status === "queued").length}
            </strong>{" "}
            {t("scheduled posts")}
          </span>
          <span>
            <strong>
              {snapshot.campaignJobCounts?.succeeded ??
                snapshot.jobs.filter((job) => job.campaignId && job.status === "succeeded").length}
            </strong>{" "}
            {t("sent posts")}
          </span>
          <span>
            <strong>
              {snapshot.campaignJobCounts
                ? (snapshot.campaignJobCounts.review ?? 0) +
                  (snapshot.campaignJobCounts.failed ?? 0)
                : snapshot.jobs.filter(
                    (job) => job.campaignId && ["review", "failed"].includes(job.status),
                  ).length}
            </strong>{" "}
            {t("need your attention")}
          </span>
        </div> : null}
        <div className="flex min-w-0 flex-col gap-3">
          <CampaignListTools
            search={search}
            onSearch={setSearch}
            statusFilter={statusFilter}
            onStatusFilter={setStatusFilter}
            count={snapshot.campaigns.length}
          />
          {showCampaignPreview ? (
            <section>
              <CampaignDetail
                key={`${socialQueryScope(client).join(":")}:${detailEpoch}:${selectedId}`}
                client={client}
                snapshot={snapshot}
                projects={projects}
                run={run}
                selected={selected}
                onEdit={startEdit}
              />
            </section>
          ) : (
            <Empty>{t("No campaigns yet. Use Prepare content to write the first one.")}</Empty>
          )}
        </div>
      </div>
      <ProductKnowledge
        client={client}
        profiles={snapshot.profiles}
        projects={projects}
        initialProject={initialProject}
        projectIntent={projectIntent}
        run={run}
        accounts={snapshot.accounts}
        hostOnline={snapshot.hostOnline}
      />
    </div>
  );
}
