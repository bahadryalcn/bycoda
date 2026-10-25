import { useSocialPending } from "./useSocialPending";
import { useContext as useSocialContext } from "react";
import { SocialBusyContext as SocialLockContext } from "./socialContext";
import { TextField } from "../../../shared/ui/TextField";
import { NativeSearchableSelect } from "../../../shared/ui/NativeSearchableSelect";
import { Badge } from "../../../shared/ui/Badge";
import { Button } from "../../../shared/ui/Button";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { socialRows } from "../model/socialWorkspace";
import type { SocialPublishingPlan } from "../model/social";
import {
  localPublishingTimeZone,
  publishingPlanTime,
  publishingPauseFeedback,
  publishingSchedule,
  publishingScheduleSummary,
  scheduleFields,
  type PublishingScheduleFields,
} from "../model/publishingPlanForm";
import { SocialMultiSelect } from "./SocialMultiSelect";
import { SocialSetupEditor } from "./SocialSetupEditor";
import {
  Empty,
  Notice,
  StatusBadge,
  closeComposer,
  field,
  names,
  type Props,
} from "./socialShared";

const defaultSchedule = (): PublishingScheduleFields => ({
  timeZone: localPublishingTimeZone(),
  startTime: "09:00",
  endTime: "18:00",
  minHours: "2",
  maxHours: "5",
});

export function PublishingPlans({ client, snapshot, projects, initialProject, run }: Props) {
  const pendingUi = useSocialPending();
  const socialLocked = useSocialContext(SocialLockContext);
  useLocale();
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
  const selected = plans.find((plan) => plan.id === selectedId);
  const editingPlan = plans.find((plan) => plan.id === editingId);
  const completedCampaignIds =
    editingPlan?.campaigns
      .slice(0, editingPlan.nextIndex)
      .map((reference) => reference.campaignId) ?? [];
  const account = snapshot.accounts.find((item) => item.id === accountId);
  const availableCampaigns = campaigns.filter(
    (campaign) =>
      campaign.projectIds.includes(projectId) &&
      campaign.variants.some((variant) => variant.accountId === accountId),
  );
  const validation = publishingSchedule(scheduleDraft);
  const invalidPool =
    !campaignIds.length ||
    campaignIds.some((id) => !availableCampaigns.some((campaign) => campaign.id === id));
  const canSave =
    !!name.trim() && !!account && !!projectId && !!validation.schedule && !invalidPool;
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
  const activationReason = !selected
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
                      : !reviewConfirmed
                        ? t("Tick the plan and content confirmation below.")
                        : "";
  const updateSchedule = (change: Partial<PublishingScheduleFields>) =>
    setScheduleDraft((current) => ({ ...current, ...change }));

  return (
    <section
      className="social-publishing-plans"
      aria-label={t("Automatic publishing plans")}
      data-empty={!plans.length}
    >
      <header className="social-section-heading">
        <div>
          <h2>{t("Automatic publishing plans")}</h2>
          <p className="social-muted">{t("Share approved campaigns at the times you choose.")}</p>
        </div>
        <StatusBadge
          status={plans.some((plan) => plan.enabled) ? "active" : "paused"}
          label={`${plans.filter((plan) => plan.enabled).length} etkin plan`}
        />
      </header>
      {!supported ? (
        <Notice kind="info" title={t("Host update required")}>
          {t(
            "This host version does not support scheduled publishing plans. Reopen with an up-to-date host.",
          )}
        </Notice>
      ) : (
        <>
          <SocialSetupEditor
            inline={!plans.length}
            title={editingId ? t("Edit publishing plan") : t("Create automatic publishing plan")}
            editing={editVersion}
            description={t(
              "Choose the account, content pool and schedule. The plan is saved paused; enable it separately to publish.",
            )}
          >
            <form
              className="social-form social-plan-setup"
              onSubmit={(event) => {
                const form = event.currentTarget;
                field(event);
                if (!canSave || !validation.schedule) return;
                let saved: SocialPublishingPlan | undefined;
                void (async () => {
                  if (
                    !(await pendingUi.run("publishing-plans.save-changes-as-paused", () =>
                      run(async () => {
                        saved = await client.request<SocialPublishingPlan>(
                          editingId ? "publishing-plans.update" : "publishing-plans.create",
                          {
                            ...(editingId
                              ? { id: editingId, expectedRevision: editingRevision }
                              : {}),
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
                  closeComposer(form);
                })();
              }}
            >
              <div className="social-plan-content">
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
                        <span>
                          {campaigns.find((campaign) => campaign.id === id)?.name ??
                            t("Campaign not found")}
                        </span>
                        <div className="social-actions">
                          <Button
                            variant="secondary"
                            type="button"
                            disabled={socialLocked || index <= completedCampaignIds.length}
                            aria-label={t("Move campaign {p0} up", { p0: index + 1 })}
                            onClick={() =>
                              setCampaignIds((current) => {
                                const next = [...current];
                                [next[index - 1], next[index]] = [next[index], next[index - 1]];
                                return next;
                              })
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
                              setCampaignIds((current) => {
                                const next = [...current];
                                [next[index + 1], next[index]] = [next[index], next[index + 1]];
                                return next;
                              })
                            }
                          >
                            {t("Down")}
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ol>
                ) : null}
                {!availableCampaigns.length ? (
                  <Notice kind="info">
                    {t(
                      "There are no campaigns for this account and project. Prepare content in Campaigns and approve it for publishing.",
                    )}
                  </Notice>
                ) : null}
                <p className="social-muted">
                  {t(
                    "Each campaign is shared once. The plan stops when the content pool ends; add new approved campaigns to continue.",
                  )}
                </p>
                <Button
                  loading={pendingUi.is("publishing-plans.save-changes-as-paused")}
                  type="submit"
                  variant="secondary"
                  disabled={socialLocked || !canSave}
                >
                  {editingId ? t("Save changes as paused") : t("Save plan as paused")}
                </Button>
                {!name.trim() || !account || !projectId || invalidPool ? (
                  <small className="social-muted">
                    {t("To save, choose a plan name, account, project and at least one campaign.")}
                  </small>
                ) : null}
              </div>
              <fieldset>
                <legend>{t("When should it share?")}</legend>
                <div className="social-actions" aria-label={t("Schedule presets")}>
                  <Button
                    disabled={socialLocked}
                    variant="secondary"
                    type="button"
                    onClick={() =>
                      updateSchedule({
                        startTime: "09:00",
                        endTime: "18:00",
                        minHours: "2",
                        maxHours: "5",
                      })
                    }
                  >
                    {t("09:00–18:00 · every 2–5 hours")}
                  </Button>
                  <Button
                    disabled={socialLocked}
                    variant="secondary"
                    type="button"
                    onClick={() =>
                      updateSchedule({
                        startTime: "09:00",
                        endTime: "22:00",
                        minHours: "3",
                        maxHours: "3",
                      })
                    }
                  >
                    {t("09:00–22:00 · every 3 hours")}
                  </Button>
                  <Button
                    disabled={socialLocked}
                    variant="secondary"
                    type="button"
                    onClick={() => updateSchedule({ startTime: "00:00", endTime: "00:00" })}
                  >
                    {t("All day")}
                  </Button>
                </div>
                <div className="social-form-grid">
                  <TextField
                    disabled={socialLocked}
                    label={t("Start time")}
                    type="time"
                    value={scheduleDraft.startTime}
                    onChange={(event) => updateSchedule({ startTime: event.target.value })}
                    required
                  />
                  <TextField
                    disabled={socialLocked}
                    label={t("End time")}
                    type="time"
                    value={scheduleDraft.endTime}
                    onChange={(event) => updateSchedule({ endTime: event.target.value })}
                    required
                  />
                  <TextField
                    disabled={socialLocked}
                    label={t("Shortest interval · hours")}
                    type="number"
                    step="any"
                    min="0"
                    max="168"
                    value={scheduleDraft.minHours}
                    onChange={(event) => updateSchedule({ minHours: event.target.value })}
                    required
                  />
                  <TextField
                    disabled={socialLocked}
                    label={t("Longest interval · hours")}
                    type="number"
                    step="any"
                    min="0"
                    max="168"
                    value={scheduleDraft.maxHours}
                    onChange={(event) => updateSchedule({ maxHours: event.target.value })}
                    required
                  />
                </div>
                <div>
                  <TextField
                    disabled={socialLocked}
                    label={t("Time zone")}
                    value={scheduleDraft.timeZone}
                    onChange={(event) => updateSchedule({ timeZone: event.target.value })}
                    placeholder="Europe/Istanbul"
                    required
                    list="social-publishing-timezones"
                  />
                  <datalist id="social-publishing-timezones">
                    <option value="Europe/Istanbul" />
                    <option value="Europe/London" />
                    <option value="Europe/Berlin" />
                    <option value="America/New_York" />
                    <option value="UTC" />
                  </datalist>
                </div>
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
            </form>
          </SocialSetupEditor>
          <div className="social-columns">
            <section>
              <h3>
                {t("Publishing plans")} <small>{plans.length}</small>
              </h3>
              {plans.length ? (
                plans.map((plan) => (
                  <Button
                    disabled={socialLocked}
                    type="button"
                    variant="tab"
                    key={plan.id}
                    className="social-row"
                    aria-pressed={plan.id === selectedId}
                    onClick={() => {
                      setSelectedId(plan.id);
                      setReviewed(undefined);
                    }}
                  >
                    <strong>{plan.name}</strong>
                    <StatusBadge status={state(plan)} />
                    <span>
                      {snapshot.accounts.find((item) => item.id === plan.accountId)?.name ??
                        t("Account removed")}
                    </span>
                    <small>
                      {t("{p0} items left", {
                        p0: Math.max(0, plan.campaigns.length - plan.nextIndex),
                      })}
                      {plan.nextRunAt
                        ? ` · ${publishingPlanTime(plan.nextRunAt, plan.schedule.timeZone)}`
                        : ""}
                    </small>
                  </Button>
                ))
              ) : (
                <Empty title={t("No publishing plans yet")}>
                  {t(
                    "Create a plan by choosing your account, approved campaigns and sharing times.",
                  )}
                </Empty>
              )}
            </section>
            <section>
              {!selected ? (
                <Empty title={t("Publishing plan details")}>
                  {t("Select a plan to see its schedule, next content and latest result.")}
                </Empty>
              ) : (
                <>
                  <header className="social-record-heading">
                    <h3>{selected.name}</h3>
                    <StatusBadge status={state(selected)} />
                  </header>
                  <p className="social-schedule-summary">
                    {publishingScheduleSummary(selected.schedule)}
                  </p>
                  <dl className="social-definition-grid">
                    <div>
                      <dt>{t("Account")}</dt>
                      <dd>{selectedAccount?.name ?? t("Account removed")}</dd>
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
                  {selected.completedAt ? (
                    <Notice kind="success" title={t("Content pool completed")}>
                      {t(
                        "All content has been processed. Edit the plan and add new approved campaigns to keep sharing.",
                      )}
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
                      const poolStatus =
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
                              status={poolStatus}
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
                  <Notice kind="info">
                    {t(
                      "The plan uses approved content only and stops when the pool ends. It runs independently of the app while the host is online.",
                    )}
                  </Notice>
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
                  {!selected.enabled && activationReason ? (
                    <small className="social-muted">{activationReason}</small>
                  ) : null}
                  <div className="social-actions">
                    <Badge variant="label" appearance="outline">
                      {t("Publishes as {p0} · {p1}", {
                        p0: selectedAccount?.name ?? t("Account removed"),
                        p1:
                          projects.find((project) => project.id === selected.projectId)?.name ||
                          selected.projectId,
                      })}
                    </Badge>
                    {selected.enabled ? (
                      <Button
                        loading={pendingUi.is("publishing-plan.pause")}
                        disabled={socialLocked}
                        type="button"
                        variant="secondary"
                        onClick={() =>
                          void pendingUi.run("publishing-plan.pause", () =>
                            run(
                              () => client.request("publishing-plans.pause", { id: selected.id }),
                              t("Automatic publishing plan paused."),
                            ),
                          )
                        }
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
                      variant="secondary"
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
                      }}
                    >
                      {t("Edit plan")}
                    </Button>
                  </div>
                </>
              )}
            </section>
          </div>
        </>
      )}
    </section>
  );
}
