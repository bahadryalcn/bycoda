import { useSocialPending } from "./useSocialPending";
import {
  useContext as useSocialContext,
  useId,
  useState,
  type FormEvent,
  type MouseEvent,
} from "react";
import { SocialBusyContext as SocialLockContext } from "./socialContext";
import { TextField } from "../../../shared/ui/TextField";
import { NativeSearchableSelect } from "../../../shared/ui/NativeSearchableSelect";
import { Button } from "../../../shared/ui/Button";
import { ContinuousList } from "../../../shared/ui/ContinuousList";
import { SocialPublishingPlanRow } from "./SocialPublishingPlanRow";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { Stepper } from "../../../shared/ui/Stepper";
import { Sparkles } from "../../../shared/ui/icons";
import { t, useLocale } from "../../../shared/i18n";
import { socialRows } from "../model/socialWorkspace";
import { socialQueryScope } from "../model/socialQuery";
import type { SocialPublishingPlan } from "../model/social";
import {
  PLAN_STEP_IDS,
  localPublishingTimeZone,
  movePoolEntry,
  planContentBlockers,
  planContentWarnings,
  planSuggestBlockedReason,
  publishingPlanTime,
  publishingPauseFeedback,
  publishingSchedule,
  publishingScheduleSummary,
  scheduleFields,
  type PlanBlocker,
  type PlanStepId,
  type PublishingScheduleFields,
} from "../model/publishingPlanForm";
import {
  PlanScheduleFields,
  PlanSuggestionPanel,
  usePlanTextAgent,
  type PlanDraftValues,
} from "./PlanSuggestion";
import { SocialMultiSelect } from "./SocialMultiSelect";
import {
  Composer,
  ComposerActions,
  Empty,
  Notice,
  StatusBadge,
  closeComposer,
  names,
  type Props,
} from "./socialShared";
import "./social-programs.css";
import "./social-plans.css";
const defaultSchedule = (): PublishingScheduleFields => ({
  timeZone: localPublishingTimeZone(),
  startTime: "09:00",
  endTime: "18:00",
  minHours: "2",
  maxHours: "5",
});
export function PublishingPlans({
  client,
  snapshot,
  projects,
  initialProject,
  run,
  onOpenContent,
  onOpenSettings,
  onOpenAccounts,
}: Props & { onOpenAccounts?: () => void }) {
  const pendingUi = useSocialPending();
  const socialLocked = useSocialContext(SocialLockContext);
  useLocale();
  const reasonId = useId();
  const formId = useId();
  const campaigns = socialRows(snapshot.campaigns, snapshot.related?.campaigns);
  const jobs = socialRows(snapshot.jobs, snapshot.related?.jobs);
  const plans = snapshot.publishingPlans ?? [];
  const supported = snapshot.publishingPlans !== undefined;
  const [selectedId, setSelectedId] = useState(plans[0]?.id ?? "");
  const [editingId, setEditingId] = useState<string>();
  const [editingRevision, setEditingRevision] = useState<number>();
  const [editVersion, setEditVersion] = useState(0);
  const [name, setName] = useState("");
  const [accountId, setAccountId] = useState(snapshot.accounts[0]?.id ?? "");
  const [projectId, setProjectId] = useState(initialProject ?? projects[0]?.id ?? "");
  const [campaignIds, setCampaignIds] = useState<string[]>([]);
  const [scheduleDraft, setScheduleDraft] = useState(defaultSchedule);
  const [reviewed, setReviewed] = useState<{ id: string; revision: number }>();
  // The dialog's whole draft lives here (one owner): steps only choose what is shown, so Back and
  // Next, closing the dialog and visiting another Social section never reset a value.
  const [step, setStep] = useState<PlanStepId>("content");
  const [view, setView] = useState<"plan" | "suggest">("plan");
  const [openRequest, setOpenRequest] = useState(0);
  const [dialogUsed, setDialogUsed] = useState(false);
  const selected = plans.find((plan) => plan.id === selectedId) ?? plans[0];
  const editingPlan = plans.find((plan) => plan.id === editingId);
  const completedCampaignIds =
    editingPlan?.campaigns
      .slice(0, editingPlan.nextIndex)
      .map((reference) => reference.campaignId) ?? [];
  const account = snapshot.accounts.find((item) => item.id === accountId);
  const projectLabel = (id: string) => {
    const project = projects.find((item) => item.id === id);
    return project?.name || project?.cwd || id;
  };
  const availableCampaigns = campaigns.filter(
    (campaign) =>
      campaign.projectIds.includes(projectId) &&
      campaign.variants.some((variant) => variant.accountId === accountId),
  );
  const validation = publishingSchedule(scheduleDraft);
  const publishGranted = !!account?.grants[projectId]?.includes("publish");
  const contentBlockers = planContentBlockers({
    name,
    accountCount: snapshot.accounts.length,
    accountFound: !!account,
    projectId,
    availableCampaignIds: availableCampaigns.map((campaign) => campaign.id),
    campaignIds,
  });
  const contentWarnings = planContentWarnings({
    accountFound: !!account,
    publishGranted,
    campaignIds,
    approvedCampaignIds: snapshot.approvedCampaignIds,
  });
  const contentValid = !contentBlockers.length;
  const scheduleValid = !!validation.schedule;
  const canSave = contentValid && scheduleValid;
  const stepValid: Record<PlanStepId, boolean> = {
    content: contentValid,
    schedule: scheduleValid,
    review: canSave,
  };
  const reachable: PlanStepId[] = [
    "content",
    ...(contentValid ? (["schedule"] as const) : []),
    ...(canSave ? (["review"] as const) : []),
  ];
  // A value that changes underneath (for example an approval) can make the shown step unreachable:
  // fall back to the furthest step that still is, so the blocker appears in the step that owns it.
  const current: PlanStepId = reachable.includes(step) ? step : reachable[reachable.length - 1];
  const currentIndex = PLAN_STEP_IDS.indexOf(current);
  const stepReason =
    current === "review"
      ? ""
      : current === "content"
        ? (contentBlockers[0]?.text ?? "")
        : (validation.error ?? "");
  const stepLabels: Record<PlanStepId, string> = {
    content: t("Account and content"),
    schedule: t("Schedule"),
    review: t("Review"),
  };
  const eligibleForAi = availableCampaigns.filter((campaign) => !campaign.paused);
  const { agent, state: agentState } = usePlanTextAgent(client, accountId, supported && dialogUsed);
  const suggestBlocked = planSuggestBlockedReason({
    hostOnline: snapshot.hostOnline,
    accountFound: !!account,
    projectId,
    publishGranted,
    agent: agentState,
    eligibleCount: eligibleForAi.length,
    narrowedCount: 0,
  });
  const replacesDraft = !!editingId || !!name.trim() || campaignIds.length > 0;
  const selectedAccount = snapshot.accounts.find((item) => item.id === selected?.accountId);
  const selectedJob = jobs.find(
    (job) => job.id === (selected?.pendingJobId ?? selected?.lastJobId),
  );
  const selectedCapability = snapshot.capabilities[selected?.accountId ?? ""]?.find(
    (item) => item.operation === "publish",
  );
  const remaining = selected ? Math.max(0, selected.campaigns.length - selected.nextIndex) : 0;
  const state = (plan: SocialPublishingPlan) =>
    plan.completedAt
      ? "completed"
      : plan.enabled
        ? "active"
        : publishingPauseFeedback(plan.pausedReason).status;
  const pauseFeedback = publishingPauseFeedback(selected?.pausedReason);
  const resultFeedback = publishingPauseFeedback(selectedJob?.error);
  const selectedApproved = selected?.campaigns.every(
    (reference) =>
      snapshot.approvedCampaignIds?.includes(reference.campaignId) &&
      campaigns.some(
        (campaign) =>
          campaign.id === reference.campaignId && campaign.revision === reference.revision,
      ),
  );
  const reviewConfirmed =
    reviewed?.id === selected?.id && reviewed?.revision === selected?.revision;
  const blockReason = !selected
    ? t("Select a publishing plan.")
    : !remaining
      ? t("The content pool is complete. Add new approved campaigns.")
      : !snapshot.hostOnline
        ? t("Connect the host.")
        : snapshot.stopped || !snapshot.sendingEnabled
          ? t("Sending is off. Turn it on in the sending controls.")
          : !selectedAccount?.connected
            ? t("Reconnect the account.")
            : selectedAccount.paused
              ? t("The account is paused. Resume it in Accounts.")
              : !selectedAccount.grants[selected.projectId]?.includes("publish")
                ? t("Grant publishing permission for this project in Accounts.")
                : selectedCapability && selectedCapability.status !== "available"
                  ? publishingPauseFeedback(selectedCapability.reason).message
                  : plans.some(
                        (plan) =>
                          plan.id !== selected.id &&
                          plan.accountId === selected.accountId &&
                          plan.enabled,
                      )
                    ? t("Another publishing plan is active on this account. Pause that plan first.")
                    : !selectedApproved
                      ? t(
                          "In Campaigns, approve every pool item for publishing. Reselect changed content by editing the plan.",
                        )
                      : "";
  const activationReason =
    blockReason || (!reviewConfirmed ? t("Tick the plan and content confirmation below.") : "");
  // The summary leads with what the owner has to do now.
  const nextAction = !selected
    ? undefined
    : selected.completedAt || !remaining
      ? {
          kind: "success",
          title: t("Content pool completed"),
          text: t("Edit the plan and add new approved campaigns to keep sharing."),
        }
      : selected.enabled
        ? {
            kind: "success",
            title: t("Running"),
            text: t("Nothing to do. Next publication: {p0}.", {
              p0: publishingPlanTime(selected.nextRunAt, selected.schedule.timeZone),
            }),
          }
        : blockReason
          ? { kind: "warning", title: t("Needs attention"), text: blockReason }
          : !reviewConfirmed
            ? {
                kind: "info",
                title: t("Next step"),
                text: t("Review the plan and tick the confirmation below, then enable it."),
              }
            : {
                kind: "info",
                title: t("Ready"),
                text: t("Enable automatic publishing below when you want it to start."),
              };
  const updateSchedule = (change: Partial<PublishingScheduleFields>) =>
    setScheduleDraft((value) => ({ ...value, ...change }));
  const goTo = (next: PlanStepId) => setStep(next);
  const pausePlan = (plan: SocialPublishingPlan) =>
    void pendingUi.run("publishing-plan.pause", () =>
      run(
        () => client.request("publishing-plans.pause", { id: plan.id }),
        t("Automatic publishing plan paused."),
      ),
    );
  const stopAllSending = () =>
    void pendingUi.run("publishing-plan.stop-all", () =>
      run(() => client.request("execution.stop", { stopped: true }), t("All sending stopped.")),
    );
  // A fix elsewhere closes the dialog first; the draft stays in this component.
  const leaveTo = (event: MouseEvent<HTMLElement>, go: () => void) => {
    event.currentTarget
      .closest("[data-social-composer]")
      ?.dispatchEvent(new CustomEvent("social-composer-close"));
    go();
  };
  const fixButton = (blocker: PlanBlocker) => {
    const label =
      blocker.fix === "content"
        ? t("Open Campaigns")
        : blocker.fix === "accounts"
          ? t("Open Accounts")
          : t("Open settings");
    const go =
      blocker.fix === "content"
        ? onOpenContent && (() => onOpenContent(projectId))
        : blocker.fix === "accounts"
          ? onOpenAccounts
          : onOpenSettings;
    return go ? (
      <Button variant="link" type="button" onClick={(event) => leaveTo(event, go)}>
        {label}
      </Button>
    ) : null;
  };
  const startSuggest = () => {
    setView("suggest");
    setOpenRequest((value) => value + 1);
  };
  const acceptSuggestion = (draft: PlanDraftValues) => {
    // Only fills the dialog as an unsaved new-plan draft on the Review step; nothing is saved.
    setEditingId(undefined);
    setEditingRevision(undefined);
    setName(draft.name);
    setAccountId(draft.accountId);
    setProjectId(draft.projectId);
    setCampaignIds(draft.campaignIds);
    setScheduleDraft(draft.schedule);
    setReviewed(undefined);
    setStep("review");
    setView("plan");
  };
  const submitStep = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (current !== "review") {
      if (stepValid[current]) goTo(PLAN_STEP_IDS[currentIndex + 1]);
      return;
    }
    save(event.currentTarget);
  };
  const save = (form: HTMLFormElement) => {
    if (!canSave || !validation.schedule) return;
    let saved: SocialPublishingPlan | undefined;
    void (async () => {
      if (
        !(await pendingUi.run("publishing-plans.save-changes-as-paused", () =>
          run(async () => {
            saved = await client.request<SocialPublishingPlan>(
              editingId ? "publishing-plans.update" : "publishing-plans.create",
              {
                ...(editingId ? { id: editingId, expectedRevision: editingRevision } : {}),
                name: name.trim(),
                accountId,
                projectId,
                campaignIds,
                schedule: validation.schedule,
              },
            );
          }, t("Publishing plan saved as paused. Review and enable it.")),
        )) ||
        !saved
      )
        return;
      setSelectedId(saved.id);
      setReviewed(undefined);
      setEditingId(undefined);
      setName("");
      setCampaignIds([]);
      setStep("content");
      closeComposer(form);
    })();
  };
  const suggestEntry = (place: string) => (
    <>
      <Button
        variant="secondary"
        size="sm"
        type="button"
        disabled={socialLocked || !!suggestBlocked}
        aria-describedby={suggestBlocked ? `${reasonId}-${place}` : undefined}
        startIcon={<Sparkles aria-hidden="true" />}
        onClick={startSuggest}
      >
        {t("Ask AI to suggest a plan")}
      </Button>
      {suggestBlocked ? (
        <small id={`${reasonId}-${place}`} className="social-muted" role="status">
          {suggestBlocked}
        </small>
      ) : null}
    </>
  );

  const stepper = (
    <Stepper
      label={t("Plan steps")}
      current={currentIndex}
      completed={PLAN_STEP_IDS.filter((id, index) => index < currentIndex && stepValid[id])}
      selectable={reachable}
      details="current"
      steps={PLAN_STEP_IDS.map((id, index) => ({
        id,
        label: stepLabels[id],
        error:
          index < currentIndex && !stepValid[id]
            ? id === "content"
              ? contentBlockers[0]?.text
              : validation.error
            : undefined,
      }))}
      onStepSelect={(index) => goTo(PLAN_STEP_IDS[index])}
    />
  );

  const poolStatus = (id: string) =>
    completedCampaignIds.includes(id) ? (
      <StatusBadge status="succeeded" label={t("Completed")} />
    ) : snapshot.approvedCampaignIds?.includes(id) ? (
      <StatusBadge status="approved" label={t("Approved")} />
    ) : (
      <StatusBadge status="review" label={t("Approval needed")} />
    );
  const campaignName = (id: string) =>
    campaigns.find((campaign) => campaign.id === id)?.name ?? t("Campaign not found");

  return (
    <section
      className="social-publishing-plans"
      aria-label={t("Automatic publishing plans")}
      data-state={plans.length ? "list" : "empty"}
    >
      <header className="social-section-heading">
        <div>
          <h2>{t("Automatic publishing plans")}</h2>
        </div>
        {supported && plans.length ? (
          <StatusBadge
            status={plans.some((plan) => plan.enabled) ? "active" : "paused"}
            label={t("{p0} active plans", { p0: plans.filter((plan) => plan.enabled).length })}
          />
        ) : null}
        {supported ? (
          <InfoPopover label={t("How publishing plans work")}>
            {t(
              "Each campaign is shared once. The plan stops when the content pool ends; add new approved campaigns to continue.",
            )}{" "}
            {t(
              "The plan uses approved content only and stops when the pool ends. It runs independently of the app while the host is online.",
            )}
          </InfoPopover>
        ) : null}
        {supported ? (
          <Composer
            title={editingId ? t("Edit publishing plan") : t("Create automatic publishing plan")}
            editing={editVersion}
            openRequest={openRequest}
            onOpen={() => setDialogUsed(true)}
            description={t(
              "Choose the account, content pool and schedule. The plan is saved paused; enable it separately to publish.",
            )}
          >
            {view === "suggest" ? (
              <PlanSuggestionPanel
                client={client}
                account={account}
                projectId={projectId}
                projectName={projectId ? projectLabel(projectId) : ""}
                eligible={eligibleForAi}
                hostOnline={snapshot.hostOnline}
                agent={agent}
                agentState={agentState}
                replacesDraft={replacesDraft}
                onAccept={acceptSuggestion}
                onClose={() => setView("plan")}
                onOpenContent={
                  onOpenContent && ((id, event) => leaveTo(event, () => onOpenContent(id)))
                }
                onOpenSettings={onOpenSettings && ((event) => leaveTo(event, onOpenSettings))}
              />
            ) : (
              <form
                id={formId}
                className="social-form social-plan-setup social-plan-form"
                onSubmit={submitStep}
              >
                {stepper}
                {current === "content" ? (
                  <div className="social-plan-step">
                    <TextField
                      disabled={socialLocked}
                      label={t("Plan name")}
                      required
                      maxLength={200}
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      placeholder={t("E.g. Daily X product posts")}
                    />
                    <div className="social-form-grid">
                      <label>
                        {t("Sharing account")}
                        <NativeSearchableSelect
                          label={t("Sharing account")}
                          options={
                            snapshot.accounts.length
                              ? snapshot.accounts.map((item) => ({
                                  value: item.id,
                                  label: `${item.name} · ${names[item.platform]}`,
                                }))
                              : [{ value: "", label: t("Connect an account first") }]
                          }
                          value={accountId}
                          disabled={socialLocked || completedCampaignIds.length > 0}
                          onChange={(event) => {
                            setAccountId(event.target.value);
                            setCampaignIds([]);
                          }}
                          required
                        />
                      </label>
                      <label>
                        {t("Project")}
                        <NativeSearchableSelect
                          label={t("Project")}
                          options={
                            projects.length
                              ? projects.map((project) => ({
                                  value: project.id,
                                  label: project.name || project.cwd,
                                }))
                              : [{ value: "", label: t("No project found") }]
                          }
                          value={projectId}
                          disabled={socialLocked || completedCampaignIds.length > 0}
                          onChange={(event) => {
                            setProjectId(event.target.value);
                            setCampaignIds([]);
                          }}
                          required
                        />
                      </label>
                    </div>
                    <SocialMultiSelect
                      label={t("Campaigns to share · in the order you pick")}
                      placeholder={t("Select the content pool")}
                      searchPlaceholder={t("Search campaigns")}
                      options={availableCampaigns
                        .filter((campaign) => !completedCampaignIds.includes(campaign.id))
                        .map((campaign) => ({
                          value: campaign.id,
                          label: campaign.name,
                          description: snapshot.approvedCampaignIds?.includes(campaign.id)
                            ? t("Approved for publishing")
                            : t("Publishing approval needed in Campaigns"),
                        }))}
                      selected={campaignIds.filter((id) => !completedCampaignIds.includes(id))}
                      onChange={(ids) => setCampaignIds([...completedCampaignIds, ...ids])}
                    />
                    {completedCampaignIds.length ? (
                      <Notice kind="info">
                        {t(
                          "{p0} campaigns in this plan are completed. The order of sent content, the account and the project are kept; you can change the remaining content or add new campaigns to the pool.",
                          { p0: completedCampaignIds.length },
                        )}
                      </Notice>
                    ) : null}
                    {campaignIds.length > 1 ? (
                      <ol className="social-pool-editor" aria-label={t("Sharing order")}>
                        {campaignIds.map((id, index) => (
                          <li key={id}>
                            <span>{campaignName(id)}</span>
                            <div className="social-actions">
                              <Button
                                variant="secondary"
                                type="button"
                                disabled={socialLocked || index <= completedCampaignIds.length}
                                aria-label={t("Move campaign {p0} up", { p0: index + 1 })}
                                onClick={() =>
                                  setCampaignIds((value) =>
                                    movePoolEntry(value, index, -1, completedCampaignIds.length),
                                  )
                                }
                              >
                                {t("Up")}
                              </Button>
                              <Button
                                variant="secondary"
                                type="button"
                                disabled={
                                  socialLocked ||
                                  index < completedCampaignIds.length ||
                                  index === campaignIds.length - 1
                                }
                                aria-label={t("Move campaign {p0} down", { p0: index + 1 })}
                                onClick={() =>
                                  setCampaignIds((value) =>
                                    movePoolEntry(value, index, 1, completedCampaignIds.length),
                                  )
                                }
                              >
                                {t("Down")}
                              </Button>
                            </div>
                          </li>
                        ))}
                      </ol>
                    ) : null}
                    {contentBlockers
                      .filter((blocker) => blocker.fix)
                      .map((blocker) => (
                        <Notice key={blocker.id} kind="info">
                          {blocker.text} {fixButton(blocker)}
                        </Notice>
                      ))}
                    {contentWarnings.map((warning) => (
                      <Notice key={warning.id} kind="warning">
                        {warning.text} {fixButton(warning)}
                      </Notice>
                    ))}
                    <div className="social-plan-ai">{suggestEntry("dialog")}</div>
                  </div>
                ) : current === "schedule" ? (
                  <fieldset className="social-plan-step">
                    <legend>{t("When should it share?")}</legend>
                    <PlanScheduleFields
                      value={scheduleDraft}
                      onChange={updateSchedule}
                      disabled={socialLocked}
                    />
                    {validation.error ? (
                      <Notice kind="warning">{validation.error}</Notice>
                    ) : (
                      <Notice kind="info" title={t("Sharing schedule")}>
                        {publishingScheduleSummary(validation.schedule!)}{" "}
                        {t(
                          "The first publication is prepared in the next suitable time slot; later ones are queued according to this interval.",
                        )}
                      </Notice>
                    )}
                  </fieldset>
                ) : (
                  <div className="social-plan-step" role="group" aria-label={t("Review the plan")}>
                    <dl className="social-plan-review">
                      <div>
                        <dt>{t("Plan name")}</dt>
                        <dd>{name.trim()}</dd>
                      </div>
                      <div>
                        <dt>{t("Account")}</dt>
                        <dd>{account ? `${account.name} · ${names[account.platform]}` : ""}</dd>
                      </div>
                      <div>
                        <dt>{t("Project")}</dt>
                        <dd>{projectLabel(projectId)}</dd>
                      </div>
                      <div>
                        <dt>{t("Content pool")}</dt>
                        <dd>
                          {t("{p0} campaigns", { p0: campaignIds.length })}
                          <ol className="social-plan-pool" aria-label={t("Sharing order")}>
                            {campaignIds.map((id, index) => (
                              <li key={id}>
                                <span className="social-plan-pool-name">
                                  {index + 1}. {campaignName(id)}
                                </span>
                                {poolStatus(id)}
                              </li>
                            ))}
                          </ol>
                        </dd>
                      </div>
                      <div>
                        <dt>{t("Sharing schedule")}</dt>
                        <dd>
                          {validation.schedule
                            ? publishingScheduleSummary(validation.schedule)
                            : ""}
                        </dd>
                      </div>
                      <div>
                        <dt>{t("After saving")}</dt>
                        <dd>
                          {editingId
                            ? t(
                                "Saving pauses this plan. Review it in the plan list, then enable it again; saving does not publish.",
                              )
                            : t(
                                "Saved paused. Review and activation are separate; saving does not publish.",
                              )}
                        </dd>
                      </div>
                    </dl>
                    {contentWarnings.length ? (
                      <Notice kind="warning" title={t("Before you can enable it")}>
                        <ul>
                          {contentWarnings.map((warning) => (
                            <li key={warning.id}>{warning.text}</li>
                          ))}
                        </ul>
                      </Notice>
                    ) : null}
                  </div>
                )}
                <ComposerActions className="social-plan-footer">
                  {current !== "content" ? (
                    <Button
                      variant="ghost"
                      type="button"
                      disabled={socialLocked}
                      onClick={() => goTo(PLAN_STEP_IDS[currentIndex - 1])}
                    >
                      {t("Back")}
                    </Button>
                  ) : null}
                  <small
                    id={reasonId}
                    className="social-plan-reason social-muted"
                    role="status"
                    aria-live="polite"
                  >
                    {stepReason}
                  </small>
                  {editingPlan?.enabled ? (
                    <>
                      <Button
                        loading={pendingUi.is("publishing-plan.pause")}
                        disabled={socialLocked}
                        type="button"
                        variant="secondary"
                        onClick={() => pausePlan(editingPlan)}
                      >
                        {t("Pause plan")}
                      </Button>
                      {!snapshot.stopped ? (
                        <Button
                          loading={pendingUi.is("publishing-plan.stop-all")}
                          disabled={socialLocked || !snapshot.hostOnline}
                          type="button"
                          variant="secondary"
                          tone="danger"
                          onClick={stopAllSending}
                        >
                          {t("Stop all sending")}
                        </Button>
                      ) : null}
                    </>
                  ) : null}
                  {current === "review" ? (
                    <Button
                      key="save"
                      form={formId}
                      loading={pendingUi.is("publishing-plans.save-changes-as-paused")}
                      type="submit"
                      variant="secondary"
                      disabled={socialLocked || !canSave}
                      // The second click of a double-click on Next lands here once Review is shown.
                      onClick={(event) => {
                        if (event.detail > 1) event.preventDefault();
                      }}
                    >
                      {editingId ? t("Save changes as paused") : t("Save plan as paused")}
                    </Button>
                  ) : (
                    <Button
                      key="next"
                      form={formId}
                      type="submit"
                      variant="secondary"
                      disabled={socialLocked || !stepValid[current]}
                      aria-describedby={stepReason ? reasonId : undefined}
                    >
                      {current === "content" ? t("Next") : t("Review plan")}
                    </Button>
                  )}
                </ComposerActions>
              </form>
            )}
          </Composer>
        ) : null}
      </header>
      {!supported ? (
        <Notice kind="info" title={t("Host update required")}>
          {t(
            "This host version does not support scheduled publishing plans. Reopen with an up-to-date host.",
          )}
        </Notice>
      ) : !plans.length ? (
        <Empty
          title={t("No publishing plans yet")}
          action={<div className="social-plan-empty-actions">{suggestEntry("empty")}</div>}
        >
          {t("Create a plan by choosing your account, approved campaigns and sharing times.")}
        </Empty>
      ) : (
        <div className="social-columns">
          <section aria-label={t("Publishing plans")}>
            <ContinuousList
              items={plans}
              itemKey={(plan) => plan.id}
              stateKey={`social-plans:${socialQueryScope(client).join(":")}:${snapshot.executorId}:${snapshot.programProjectId ?? "all"}`}
              requiredKey={selected?.id}
              estimateSize={96}
              renderItem={(plan) => (
                <SocialPublishingPlanRow
                  plan={plan}
                  accountName={snapshot.accounts.find((item) => item.id === plan.accountId)?.name}
                  status={state(plan)}
                  selected={plan.id === selected?.id}
                  disabled={socialLocked}
                  onSelect={() => {
                    setSelectedId(plan.id);
                    setReviewed(undefined);
                  }}
                />
              )}
            />
          </section>
          <section>
            {selected && nextAction ? (
              <>
                <header className="social-record-heading">
                  <h3>{selected.name}</h3>
                  <StatusBadge status={state(selected)} />
                </header>
                <p className="social-plan-next" data-kind={nextAction.kind} role="status">
                  <strong>{nextAction.title}</strong> {nextAction.text}
                </p>
                <p className="social-schedule-summary">
                  {publishingScheduleSummary(selected.schedule)}
                </p>
                <dl className="social-definition-grid">
                  <div>
                    <dt>{t("Account")}</dt>
                    <dd>{selectedAccount?.name ?? t("Account removed")}</dd>
                  </div>
                  <div>
                    <dt>{t("Project")}</dt>
                    <dd>{projectLabel(selected.projectId)}</dd>
                  </div>
                  <div>
                    <dt>{t("Next publication")}</dt>
                    <dd>
                      {selected.enabled
                        ? publishingPlanTime(selected.nextRunAt, selected.schedule.timeZone)
                        : t("Scheduled once enabled")}
                    </dd>
                  </div>
                  <div>
                    <dt>{t("Content pool")}</dt>
                    <dd>
                      {t("{p0} / {p1} completed · {p2} left", {
                        p0: selected.nextIndex,
                        p1: selected.campaigns.length,
                        p2: remaining,
                      })}
                    </dd>
                  </div>
                  <div>
                    <dt>{t("Last run")}</dt>
                    <dd>{publishingPlanTime(selected.lastRunAt, selected.schedule.timeZone)}</dd>
                  </div>
                </dl>
                {selectedJob ? (
                  <div className="social-inline-meta">
                    <span>{selected.pendingJobId ? t("Queued job:") : t("Latest result:")}</span>
                    <StatusBadge status={selectedJob.status} />
                    {selectedJob.error ? (
                      <Notice
                        kind={
                          selectedJob.status === "failed"
                            ? "error"
                            : selectedJob.status === "review"
                              ? "warning"
                              : resultFeedback.kind
                        }
                      >
                        {resultFeedback.message}
                        {resultFeedback.technicalDetail ? (
                          <details className="social-settings">
                            <summary>{t("Technical detail")}</summary>
                            <p className="social-message">{resultFeedback.technicalDetail}</p>
                          </details>
                        ) : null}
                      </Notice>
                    ) : null}
                  </div>
                ) : (
                  <span className="social-muted">
                    {t("No publishing job has run in this plan yet.")}
                  </span>
                )}
                {selected.pausedReason && !selected.completedAt ? (
                  <Notice kind={pauseFeedback.kind} title={pauseFeedback.title}>
                    {pauseFeedback.message}
                    {pauseFeedback.technicalDetail ? (
                      <details className="social-settings">
                        <summary>{t("Technical detail")}</summary>
                        <p className="social-message">{pauseFeedback.technicalDetail}</p>
                      </details>
                    ) : null}
                  </Notice>
                ) : null}
                <details className="social-content-pool">
                  <summary>
                    {t("Review content pool · {p0} campaigns", { p0: selected.campaigns.length })}
                  </summary>
                  {selected.campaigns.map((reference, index) => {
                    const campaign = campaigns.find((item) => item.id === reference.campaignId);
                    const variant = campaign?.variants.find(
                      (item) => item.accountId === selected.accountId,
                    );
                    const status =
                      index < selected.nextIndex
                        ? "succeeded"
                        : campaign?.revision !== reference.revision
                          ? "review"
                          : snapshot.approvedCampaignIds?.includes(reference.campaignId)
                            ? "approved"
                            : "draft";
                    return (
                      <article key={reference.campaignId} className="social-preview">
                        <div className="social-record-heading">
                          <strong>
                            {index + 1}. {campaign?.name ?? t("Campaign not found")}
                          </strong>
                          <StatusBadge
                            status={status}
                            label={index < selected.nextIndex ? t("Completed") : undefined}
                          />
                        </div>
                        {variant ? (
                          <p className="social-message">
                            {variant.text}
                            {variant.link ? `\n${variant.link}` : ""}
                          </p>
                        ) : (
                          <Notice kind="warning">
                            {t(
                              "The campaign or account content changed. Edit the plan and reselect the content pool.",
                            )}
                          </Notice>
                        )}
                      </article>
                    );
                  })}
                </details>
                {!selected.enabled && remaining > 0 ? (
                  <label className="social-check">
                    <Checkbox
                      disabled={socialLocked}
                      checked={reviewConfirmed}
                      onChange={(event) =>
                        setReviewed(
                          event.target.checked
                            ? { id: selected.id, revision: selected.revision }
                            : undefined,
                        )
                      }
                    />
                    {t(
                      "I approve automatic publishing with this account, these times and the approved content pool.",
                    )}
                  </label>
                ) : null}
                <div className="social-actions">
                  {selected.enabled ? (
                    <Button
                      loading={pendingUi.is("publishing-plan.pause")}
                      disabled={socialLocked}
                      type="button"
                      variant="secondary"
                      onClick={() => pausePlan(selected)}
                    >
                      {t("Pause plan")}
                    </Button>
                  ) : (
                    <Button
                      loading={pendingUi.is("publishing-plan.enable")}
                      type="button"
                      variant="secondary"
                      disabled={socialLocked || !!activationReason}
                      onClick={() =>
                        void pendingUi.run("publishing-plan.enable", () =>
                          run(
                            () =>
                              client.request("publishing-plans.activate", {
                                id: selected.id,
                                revision: selected.revision,
                                confirm: "ACTIVATE_PUBLISHING_PLAN",
                              }),
                            t(
                              "Automatic publishing plan enabled. The next publication time is shown above.",
                            ),
                          ),
                        )
                      }
                    >
                      {t("Enable automatic publishing")}
                    </Button>
                  )}
                  <Button
                    disabled={socialLocked}
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setEditingId(selected.id);
                      setEditingRevision(selected.revision);
                      setName(selected.name);
                      setAccountId(selected.accountId);
                      setProjectId(selected.projectId);
                      setCampaignIds(selected.campaigns.map((reference) => reference.campaignId));
                      setScheduleDraft(scheduleFields(selected.schedule));
                      setEditVersion((value) => value + 1);
                      setReviewed(undefined);
                      setStep("content");
                      setView("plan");
                    }}
                  >
                    {t("Edit plan")}
                  </Button>
                </div>
              </>
            ) : null}
          </section>
        </div>
      )}
    </section>
  );
}
