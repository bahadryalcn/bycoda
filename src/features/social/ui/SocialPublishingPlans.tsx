import { TextField } from "../../../shared/ui/TextField";
import { NativeSearchableSelect } from "../../../shared/ui/NativeSearchableSelect";
import { Button } from "../../../shared/ui/Button";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { useState } from "react";
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
    ? "Bir yayın planı seçin."
    : !remaining
      ? "İçerik havuzu tamamlandı. Yeni onaylı kampanyalar ekleyin."
      : !snapshot.hostOnline
        ? "Host bağlantısını kurun."
        : snapshot.stopped || !snapshot.sendingEnabled
          ? "Gönderim kapalı. Gönderim kontrollerinden açın."
          : !selectedAccount?.connected
            ? "Hesabı yeniden bağlayın."
            : selectedAccount.paused
              ? "Hesap durduruldu. Hesaplar bölümünden devam ettirin."
              : !selectedAccount.grants[selected.projectId]?.includes("publish")
                ? "Hesaplar bölümünde bu projeye yayın izni verin."
                : selectedCapability && selectedCapability.status !== "available"
                  ? publishingPauseFeedback(selectedCapability.reason).message
                  : plans.some(
                        (plan) =>
                          plan.id !== selected.id &&
                          plan.accountId === selected.accountId &&
                          plan.enabled,
                      )
                    ? "Bu hesapta başka bir yayın planı etkin. Önce o planı durdurun."
                    : !selectedApproved
                      ? "Kampanyalar bölümünde havuzdaki tüm içeriklere yayın onayı verin. Değişen içeriği planı düzenleyerek yeniden seçin."
                      : !reviewConfirmed
                        ? "Aşağıdaki plan ve içerik onayını işaretleyin."
                        : "";
  const updateSchedule = (change: Partial<PublishingScheduleFields>) =>
    setScheduleDraft((current) => ({ ...current, ...change }));

  return (
    <section
      className="social-publishing-plans"
      aria-label="Otomatik yayın planları"
      data-empty={!plans.length}
    >
      <header className="social-section-heading">
        <div>
          <h2>Otomatik yayın planları</h2>
          <p className="social-muted">Onaylı kampanyaları belirlediğiniz saatlerde paylaşın.</p>
        </div>
        <StatusBadge
          status={plans.some((plan) => plan.enabled) ? "active" : "paused"}
          label={`${plans.filter((plan) => plan.enabled).length} etkin plan`}
        />
      </header>
      {!supported ? (
        <Notice kind="info" title="Host güncellemesi gerekli">
          Bu host sürümü düzenli yayın planlarını desteklemiyor. Güncel host ile tekrar açın.
        </Notice>
      ) : (
        <>
          <SocialSetupEditor
            inline={!plans.length}
            title={editingId ? "Yayın planını düzenle" : "Otomatik yayın planı oluştur"}
            editing={editVersion}
            description="Hesap, içerik havuzu ve saatleri belirleyin. Plan durdurulmuş kaydedilir; yayın için ayrıca etkinleştirin."
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
                    !(await run(async () => {
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
                    }, "Yayın planı durdurulmuş kaydedildi. Planı inceleyip etkinleştirin.")) ||
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
                <label>
                  Plan adı
                  <TextField
                    hideLabel
                    label=""
                    required
                    maxLength={200}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Örn. X günlük ürün paylaşımları"
                  />
                </label>
                <div className="social-form-grid">
                  <label>
                    Paylaşım hesabı
                    <NativeSearchableSelect
                      label="Paylaşım hesabı"
                      options={
                        snapshot.accounts.length
                          ? snapshot.accounts.map((item) => ({
                              value: item.id,
                              label: `${item.name} · ${names[item.platform]}`,
                            }))
                          : [{ value: "", label: "Önce bir hesap bağlayın" }]
                      }
                      value={accountId}
                      disabled={completedCampaignIds.length > 0}
                      onChange={(event) => {
                        setAccountId(event.target.value);
                        setCampaignIds([]);
                      }}
                      required
                    />
                  </label>
                  <label>
                    Proje
                    <NativeSearchableSelect
                      label="Proje"
                      options={
                        projects.length
                          ? projects.map((project) => ({
                              value: project.id,
                              label: project.name || project.cwd,
                            }))
                          : [{ value: "", label: "Proje bulunamadı" }]
                      }
                      value={projectId}
                      disabled={completedCampaignIds.length > 0}
                      onChange={(event) => {
                        setProjectId(event.target.value);
                        setCampaignIds([]);
                      }}
                      required
                    />
                  </label>
                </div>

                <SocialMultiSelect
                  label="Paylaşılacak kampanyalar · seçtiğiniz sırayla"
                  placeholder="İçerik havuzunu seçin"
                  searchPlaceholder="Kampanya ara"
                  options={availableCampaigns
                    .filter((campaign) => !completedCampaignIds.includes(campaign.id))
                    .map((campaign) => ({
                      value: campaign.id,
                      label: campaign.name,
                      description: snapshot.approvedCampaignIds?.includes(campaign.id)
                        ? "Yayın onaylı"
                        : "Kampanyalar bölümünden yayın onayı gerekli",
                    }))}
                  selected={campaignIds.filter((id) => !completedCampaignIds.includes(id))}
                  onChange={(ids) => setCampaignIds([...completedCampaignIds, ...ids])}
                />
                {completedCampaignIds.length ? (
                  <Notice kind="info">
                    Bu planda {completedCampaignIds.length} kampanya tamamlandı. Gönderilen
                    içeriklerin sırası, hesap ve proje korunur; kalan içerikleri değiştirebilir veya
                    havuza yeni kampanyalar ekleyebilirsiniz.
                  </Notice>
                ) : null}
                {campaignIds.length > 1 ? (
                  <ol className="social-pool-editor" aria-label="Paylaşım sırası">
                    {campaignIds.map((id, index) => (
                      <li key={id}>
                        <span>
                          {campaigns.find((campaign) => campaign.id === id)?.name ??
                            "Kampanya bulunamadı"}
                        </span>
                        <div className="social-actions">
                          <Button
                            variant="secondary"
                            type="button"
                            disabled={index <= completedCampaignIds.length}
                            aria-label={`${index + 1}. kampanyayı yukarı taşı`}
                            onClick={() =>
                              setCampaignIds((current) => {
                                const next = [...current];
                                [next[index - 1], next[index]] = [next[index], next[index - 1]];
                                return next;
                              })
                            }
                          >
                            Yukarı
                          </Button>
                          <Button
                            variant="secondary"
                            type="button"
                            disabled={
                              index < completedCampaignIds.length ||
                              index === campaignIds.length - 1
                            }
                            aria-label={`${index + 1}. kampanyayı aşağı taşı`}
                            onClick={() =>
                              setCampaignIds((current) => {
                                const next = [...current];
                                [next[index + 1], next[index]] = [next[index], next[index + 1]];
                                return next;
                              })
                            }
                          >
                            Aşağı
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ol>
                ) : null}
                {!availableCampaigns.length ? (
                  <Notice kind="info">
                    Bu hesap ve proje için kampanya yok. Kampanyalar bölümünde içerik hazırlayıp
                    yayın onayı verin.
                  </Notice>
                ) : null}
                <p className="social-muted">
                  Her kampanya bir kez paylaşılır. İçerik havuzu bitince plan durur; devam etmek
                  için yeni onaylı kampanyalar ekleyin.
                </p>
                <Button type="submit" variant="secondary" disabled={!canSave}>
                  {editingId ? "Değişiklikleri durdurulmuş kaydet" : "Planı durdurulmuş kaydet"}
                </Button>
                {!name.trim() || !account || !projectId || invalidPool ? (
                  <small className="social-muted">
                    Kaydetmek için plan adı, hesap, proje ve en az bir kampanya seçin.
                  </small>
                ) : null}
              </div>
              <fieldset>
                <legend>Ne zaman paylaşsın?</legend>
                <div className="social-actions" aria-label="Hazır yayın saatleri">
                  <Button
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
                    09:00–18:00 · 2–5 saat arayla
                  </Button>
                  <Button
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
                    09:00–22:00 · 3 saatte bir
                  </Button>
                  <Button
                    variant="secondary"
                    type="button"
                    onClick={() => updateSchedule({ startTime: "00:00", endTime: "00:00" })}
                  >
                    Günün tamamı
                  </Button>
                </div>
                <div className="social-form-grid">
                  <label>
                    Başlangıç saati
                    <TextField
                      hideLabel
                      label=""
                      type="time"
                      value={scheduleDraft.startTime}
                      onChange={(event) => updateSchedule({ startTime: event.target.value })}
                      required
                    />
                  </label>
                  <label>
                    Bitiş saati
                    <TextField
                      hideLabel
                      label=""
                      type="time"
                      value={scheduleDraft.endTime}
                      onChange={(event) => updateSchedule({ endTime: event.target.value })}
                      required
                    />
                  </label>
                  <label>
                    En kısa aralık · saat
                    <TextField
                      hideLabel
                      label=""
                      type="number"
                      step="any"
                      min="0"
                      max="168"
                      value={scheduleDraft.minHours}
                      onChange={(event) => updateSchedule({ minHours: event.target.value })}
                      required
                    />
                  </label>
                  <label>
                    En uzun aralık · saat
                    <TextField
                      hideLabel
                      label=""
                      type="number"
                      step="any"
                      min="0"
                      max="168"
                      value={scheduleDraft.maxHours}
                      onChange={(event) => updateSchedule({ maxHours: event.target.value })}
                      required
                    />
                  </label>
                </div>
                <label>
                  Saat dilimi
                  <TextField
                    hideLabel
                    label=""
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
                </label>
                {validation.error ? (
                  <Notice kind="warning">{validation.error}</Notice>
                ) : (
                  <Notice kind="info" title="Paylaşım takvimi">
                    {publishingScheduleSummary(validation.schedule!)} İlk yayın bir sonraki uygun
                    zaman diliminde hazırlanır; sonraki yayınlar bu aralığa göre sıraya alınır.
                  </Notice>
                )}
              </fieldset>
            </form>
          </SocialSetupEditor>
          <div className="social-columns">
            <section>
              <h3>
                Yayın planları <small>{plans.length}</small>
              </h3>
              {plans.length ? (
                plans.map((plan) => (
                  <Button
                    type="submit"
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
                        "Hesap kaldırıldı"}
                    </span>
                    <small>
                      {Math.max(0, plan.campaigns.length - plan.nextIndex)} içerik kaldı
                      {plan.nextRunAt
                        ? ` · ${publishingPlanTime(plan.nextRunAt, plan.schedule.timeZone)}`
                        : ""}
                    </small>
                  </Button>
                ))
              ) : (
                <Empty title="Henüz yayın planı yok">
                  Hesabınızı, onaylı kampanyaları ve paylaşım saatlerini seçerek bir plan oluşturun.
                </Empty>
              )}
            </section>
            <section>
              {!selected ? (
                <Empty title="Yayın planı ayrıntıları">
                  Saatleri, sıradaki içeriği ve son sonucu görmek için bir plan seçin.
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
                      <dt>Hesap</dt>
                      <dd>{selectedAccount?.name ?? "Hesap kaldırıldı"}</dd>
                    </div>
                    <div>
                      <dt>Sıradaki yayın</dt>
                      <dd>
                        {selected.enabled
                          ? publishingPlanTime(selected.nextRunAt, selected.schedule.timeZone)
                          : "Etkinleştirilince planlanır"}
                      </dd>
                    </div>
                    <div>
                      <dt>İçerik havuzu</dt>
                      <dd>
                        {selected.nextIndex} / {selected.campaigns.length} tamamlandı · {remaining}{" "}
                        kaldı
                      </dd>
                    </div>
                    <div>
                      <dt>Son çalışma</dt>
                      <dd>{publishingPlanTime(selected.lastRunAt, selected.schedule.timeZone)}</dd>
                    </div>
                  </dl>
                  {selectedJob ? (
                    <div className="social-inline-meta">
                      <span>{selected.pendingJobId ? "Sıradaki iş:" : "Son sonuç:"}</span>
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
                              <summary>Teknik ayrıntı</summary>
                              <p className="social-message">{resultFeedback.technicalDetail}</p>
                            </details>
                          ) : null}
                        </Notice>
                      ) : null}
                    </div>
                  ) : (
                    <span className="social-muted">Bu planda henüz yayın işi çalışmadı.</span>
                  )}
                  {selected.pausedReason && !selected.completedAt ? (
                    <Notice kind={pauseFeedback.kind} title={pauseFeedback.title}>
                      {pauseFeedback.message}
                      {pauseFeedback.technicalDetail ? (
                        <details className="social-settings">
                          <summary>Teknik ayrıntı</summary>
                          <p className="social-message">{pauseFeedback.technicalDetail}</p>
                        </details>
                      ) : null}
                    </Notice>
                  ) : null}
                  {selected.completedAt ? (
                    <Notice kind="success" title="İçerik havuzu tamamlandı">
                      Tüm içerikler işlendi. Yeni paylaşımlar için planı düzenleyip yeni onaylı
                      kampanyalar ekleyin.
                    </Notice>
                  ) : null}
                  <details className="social-content-pool">
                    <summary>İçerik havuzunu incele · {selected.campaigns.length} kampanya</summary>
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
                              {index + 1}. {campaign?.name ?? "Kampanya bulunamadı"}
                            </strong>
                            <StatusBadge
                              status={poolStatus}
                              label={index < selected.nextIndex ? "Tamamlandı" : undefined}
                            />
                          </div>
                          {variant ? (
                            <p className="social-message">
                              {variant.text}
                              {variant.link ? `\n${variant.link}` : ""}
                            </p>
                          ) : (
                            <Notice kind="warning">
                              Kampanya veya hesap içeriği değişti. Planı düzenleyip içerik havuzunu
                              yeniden seçin.
                            </Notice>
                          )}
                        </article>
                      );
                    })}
                  </details>
                  <Notice kind="info">
                    Plan yalnızca onaylı içerikleri kullanır ve havuz bittiğinde durur. Host açıkken
                    uygulamadan ayrı çalışır.
                  </Notice>
                  {!selected.enabled && remaining > 0 ? (
                    <label className="social-check">
                      <Checkbox
                        checked={reviewConfirmed}
                        onChange={(event) =>
                          setReviewed(
                            event.target.checked
                              ? { id: selected.id, revision: selected.revision }
                              : undefined,
                          )
                        }
                      />
                      Bu hesap, saatler ve onaylı içerik havuzuyla otomatik yayın yapılmasını
                      onaylıyorum.
                    </label>
                  ) : null}
                  <div className="social-actions">
                    {selected.enabled ? (
                      <Button
                        type="submit"
                        variant="secondary"
                        onClick={() =>
                          void run(
                            () => client.request("publishing-plans.pause", { id: selected.id }),
                            "Otomatik yayın planı durduruldu.",
                          )
                        }
                      >
                        Planı durdur
                      </Button>
                    ) : (
                      <Button
                        type="submit"
                        variant="secondary"
                        disabled={!!activationReason}
                        onClick={() =>
                          void run(
                            () =>
                              client.request("publishing-plans.activate", {
                                id: selected.id,
                                revision: selected.revision,
                                confirm: "ACTIVATE_PUBLISHING_PLAN",
                              }),
                            "Otomatik yayın planı etkinleştirildi. Sıradaki yayın zamanı yukarıda görünür.",
                          )
                        }
                      >
                        Otomatik yayını etkinleştir
                      </Button>
                    )}
                    <Button
                      type="submit"
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
                      Planı düzenle
                    </Button>
                  </div>
                  {!selected.enabled && activationReason ? (
                    <small className="social-muted">{activationReason}</small>
                  ) : null}
                </>
              )}
            </section>
          </div>
        </>
      )}
    </section>
  );
}
