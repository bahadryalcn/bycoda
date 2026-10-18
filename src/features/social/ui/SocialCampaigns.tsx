import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { TextField } from "../../../shared/ui/TextField";
import { NativeSelect } from "../../../shared/ui/Select";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { TextareaField } from "../../../shared/ui/TextareaField";
import { Button } from "../../../shared/ui/Button";
import { SearchInput } from "../../../shared/ui/SearchInput";
import { SocialFilters } from "./SocialFilters";
import { t } from "../../../shared/i18n";
import { useContext, useState } from "react";
import { SocialPanelActiveContext } from "./socialContext";
import { useSocialWorkspaceFilter } from "./useSocialWorkspaceFilter";
import { SocialPrograms } from "./SocialPrograms";
import { TikTokPublishingFields } from "./TikTokPublishingFields";
import { XMediaFields } from "./XMediaFields";
import { useQueryClient } from "@tanstack/react-query";
import { socialQueryScope } from "../model/socialQuery";
import type {
  CampaignVariant,
  SocialCampaign,
  SocialSnapshot,
  SocialPolicy,
  SocialProjectProfile,
  SocialJob,
} from "../model/social";
import type { HostProject } from "../../connections/model/protocol";
import type { SocialClient } from "../model/socialClient";
import {
  DEFAULT_SOCIAL_POLICIES,
  effectiveSocialPolicy,
  socialCharacterCount,
  socialLimit,
} from "../model/socialPolicy";
import { JobList } from "./SocialManagement";
import { SocialMultiSelect } from "./SocialMultiSelect";
import {
  Empty,
  Composer,
  closeComposer,
  Projects,
  Notice,
  StatusBadge,
  field,
  names,
  time,
  youtubeDefaults,
  type Props,
  type Run,
} from "./socialShared";
function dateInput(value: number) {
  if (!Number.isFinite(value)) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Date(value - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
function campaignState(
  campaign: SocialCampaign,
  jobs: SocialJob[],
  states?: SocialSnapshot["campaignStates"],
) {
  if (states?.[campaign.id]) return states[campaign.id];
  const targets = jobs.filter((job) => job.campaignId === campaign.id);
  if (targets.some((job) => job.status === "review")) return "review";
  if (targets.some((job) => job.status === "failed")) return "failed";
  if (targets.some((job) => job.status === "running")) return "running";
  if (campaign.paused) return "paused";
  if (targets.some((job) => job.status === "queued")) return "queued";
  if (targets.length && targets.every((job) => job.status === "succeeded")) return "succeeded";
  if (targets.some((job) => job.status === "succeeded")) return "partial";
  if (targets.length && targets.every((job) => job.status === "cancelled")) return "cancelled";
  return "draft";
}
export function Campaigns({
  client,
  snapshot,
  projects,
  initialProject,
  run,
  onFilterChange,
}: Props) {
  const queryClient = useQueryClient();
  const [view, setView] = useState<"manual" | "ai">("manual");
  const active = useContext(SocialPanelActiveContext);
  const [selectedProjects, setSelectedProjects] = useState<string[]>(
    initialProject ? [initialProject] : [],
  );
  const [variants, setVariants] = useState<CampaignVariant[]>([]);
  const [name, setName] = useState("");
  const [editingId, setEditingId] = useState<string>();
  const [editVersion, setEditVersion] = useState(0);
  const [selectedId, setSelectedId] = useState(snapshot.campaigns[0]?.id ?? "");
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
  const [approvalConfirmed, setApprovalConfirmed] = useState(false);
  const selected = snapshot.campaigns.find((item) => item.id === selectedId);
  const visibleCampaigns = snapshot.campaigns.filter(
    (campaign) =>
      hostFiltered ||
      (campaign.name.toLocaleLowerCase("tr").includes(search.toLocaleLowerCase("tr")) &&
        (!statusFilter ||
          campaignState(campaign, snapshot.jobs, snapshot.campaignStates) === statusFilter)),
  );
  const publicFacts = snapshot.profiles
    .filter((profile) => selectedProjects.includes(profile.projectId))
    .flatMap((profile) => profile.facts);
  const validProjects =
    selectedProjects.length > 0 &&
    selectedProjects.every((id) => projects.some((project) => project.id === id));
  const hasDraftAccess = (accountId: string) =>
    selectedProjects.every((id) =>
      snapshot.accounts.find((account) => account.id === accountId)?.grants[id]?.includes("draft"),
    );
  const variantLimit = (variant: CampaignVariant) => {
    const account = snapshot.accounts.find((item) => item.id === variant.accountId);
    return account
      ? socialLimit(
          effectiveSocialPolicy(snapshot.policies ?? DEFAULT_SOCIAL_POLICIES, account.platform),
          "content",
        )
      : undefined;
  };
  const variantCount = (variant: CampaignVariant) =>
    socialCharacterCount([variant.text, variant.link].filter(Boolean).join("\n"));
  const invalidVariants = variants.some((variant) => {
    const limit = variantLimit(variant);
    return (
      !snapshot.accounts.some((account) => account.id === variant.accountId) ||
      !hasDraftAccess(variant.accountId) ||
      !variant.text.trim() ||
      !Number.isFinite(variant.scheduledAt) ||
      (limit !== undefined && variantCount(variant) > limit) ||
      variant.factIds.some((id) => !publicFacts.some((fact) => fact.id === id))
    );
  });
  const [videoProgress, setVideoProgress] = useState<Record<string, number>>({});
  const [preview, setPreview] = useState<{
    campaign: SocialCampaign;
    targets: {
      accountId: string;
      capability: { status: string; reason: string };
      contentError?: string;
      approved: boolean;
    }[];
  } | null>(null);
  const currentPreview =
    selected &&
    preview?.campaign.id === selected.id &&
    JSON.stringify(preview.campaign) === JSON.stringify(selected)
      ? preview
      : null;
  const canApprove =
    !!currentPreview &&
    currentPreview.targets.length > 0 &&
    currentPreview.targets.every(
      (target) => target.capability.status === "available" && !target.contentError,
    );
  const approved =
    !!currentPreview?.targets.length && currentPreview.targets.every((target) => target.approved);
  const selectedJobs = snapshot.jobs.filter((job) => job.campaignId === selected?.id);
  const editBlocked = selectedJobs.some((job) =>
    ["queued", "running", "succeeded", "review"].includes(job.status),
  );
  const canSchedule =
    canApprove &&
    approved &&
    !selected?.paused &&
    snapshot.hostOnline &&
    snapshot.sendingEnabled &&
    !snapshot.stopped;
  const scheduleReason = !currentPreview
    ? "Önce hesap ve içerik kontrolünü çalıştırın."
    : !canApprove
      ? "İşaretlenen hesap veya içerik sorununu giderip yeniden kontrol edin."
      : !approved
        ? "İçeriği okuyup yayın onayı verin."
        : selected?.paused
          ? "Kampanyayı devam ettirip yeniden kontrol edin."
          : !snapshot.hostOnline
            ? "Yayınları planlamak için host bağlantısını kurun."
            : !snapshot.sendingEnabled || snapshot.stopped
              ? "Gönderim kapalı. Otomasyonlar → Gönderim kontrolleri bölümünden gönderimi açın."
              : "";
  const update = (id: string, change: Partial<CampaignVariant>) =>
    setVariants((current) =>
      current.map((item) => (item.accountId === id ? { ...item, ...change } : item)),
    );
  return (
    <div className="social-page social-campaign-page">
      {snapshot.programsSupported ? (
        <nav className="social-campaign-modes" aria-label={t("Kampanyalar")}>
          <Button variant="tab" aria-pressed={view === "ai"} onClick={() => setView("ai")}>
            {t("AI kampanyaları")}
          </Button>
          <Button variant="tab" aria-pressed={view === "manual"} onClick={() => setView("manual")}>
            {t("Kampanyalar")}
          </Button>
        </nav>
      ) : null}
      <div hidden={view !== "ai"}>
        <SocialPanelActiveContext.Provider value={active && view === "ai"}>
          <SocialPrograms {...{ client, snapshot, projects, initialProject, run }} />
        </SocialPanelActiveContext.Provider>
      </div>
      <div className="social-campaign-manual" hidden={view !== "manual"}>
        <div className="social-stats" aria-label="Kampanya özeti">
          <span>
            <strong>{snapshot.pages?.campaigns?.total ?? snapshot.campaigns.length}</strong>{" "}
            kampanya
          </span>
          <span>
            <strong>
              {snapshot.campaignJobCounts?.queued ??
                snapshot.jobs.filter((job) => job.campaignId && job.status === "queued").length}
            </strong>{" "}
            planlanan yayın
          </span>
          <span>
            <strong>
              {snapshot.campaignJobCounts?.succeeded ??
                snapshot.jobs.filter((job) => job.campaignId && job.status === "succeeded").length}
            </strong>{" "}
            gönderilen yayın
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
            ilgilenmeniz gereken
          </span>
        </div>
        <Composer
          title={editingId ? "Kampanya taslağını düzenle" : "Yeni kampanya"}
          onOpen={() => {
            void queryClient.invalidateQueries({
              queryKey: [...socialQueryScope(client), "tiktok-creator"],
            });
          }}
          editing={editVersion}
          description="İçeriği kaydedin, kontrol edin ve yayın onayı verin. Kaydetmek gönderim başlatmaz."
        >
          <form
            className="social-form"
            onSubmit={(event) => {
              const form = event.currentTarget;
              field(event);
              let saved: SocialCampaign | undefined;
              void (async () => {
                if (
                  !(await run(async () => {
                    if (
                      !name.trim() ||
                      !validProjects ||
                      !variants.length ||
                      invalidVariants ||
                      Object.keys(videoProgress).length > 0
                    )
                      throw new Error(
                        "Proje, hesap erişimi, içerik sınırları ve yayın zamanlarını kontrol edin.",
                      );
                    await Promise.all(
                      variants.map(async (variant) => {
                        const { effective } = await client.request<{
                          effective: SocialPolicy;
                        }>("policy.get", { accountId: variant.accountId });
                        const limit = socialLimit(effective, "content");
                        if (limit !== undefined && variantCount(variant) > limit)
                          throw new Error(
                            `Bu hesap için içerik en fazla ${limit} karakter olabilir.`,
                          );
                      }),
                    );
                    saved = await client.request<SocialCampaign>("campaigns.create", {
                      ...(editingId ? { id: editingId } : {}),
                      name,
                      projectIds: selectedProjects,
                      variants,
                    });
                  }, "Kampanya taslağı kaydedildi. Önizlemeyi kontrol edip yayın onayı verebilirsiniz.")) ||
                  !saved
                )
                  return;
                setSelectedId(saved.id);
                setPreview(null);
                setApprovalConfirmed(false);
                setName("");
                setVariants([]);
                setEditingId(undefined);
                closeComposer(form);
              })();
            }}
          >
            <label>
              Kampanya adı
              <TextField
                hideLabel
                label=""
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                maxLength={200}
              />
            </label>
            <Projects
              projects={projects}
              selected={selectedProjects}
              onChange={setSelectedProjects}
            />
            {!validProjects ? <Notice kind="info">En az bir proje seçin.</Notice> : null}
            <SocialMultiSelect
              label="Sosyal hesaplar"
              placeholder="Hesap seçin"
              searchPlaceholder="Hesap veya platform ara"
              options={snapshot.accounts.map((account) => ({
                value: account.id,
                label: account.name,
                description: `${names[account.platform]}${hasDraftAccess(account.id) ? "" : " · Seçili projeler için taslak erişimi gerekli"}`,
                disabled: !hasDraftAccess(account.id),
              }))}
              selected={variants.map((variant) => variant.accountId)}
              onChange={(ids) =>
                setVariants((current) =>
                  ids.map(
                    (id) =>
                      current.find((variant) => variant.accountId === id) ?? {
                        accountId: id,
                        text: "",
                        media: [],
                        factIds: [],
                        scheduledAt: Date.now(),
                        ...(snapshot.accounts.find((account) => account.id === id)?.platform ===
                        "youtube"
                          ? { youtube: { ...youtubeDefaults } }
                          : {}),
                      },
                  ),
                )
              }
            />
            {!snapshot.accounts.length ? (
              <Notice kind="info">
                İçerik hazırlamak için Hesaplar bölümünden bir hesap bağlayın.
              </Notice>
            ) : null}
            {variants.map((variant) => (
              <fieldset key={variant.accountId} className="social-variant">
                <legend>
                  {snapshot.accounts.find((account) => account.id === variant.accountId)?.name}
                </legend>
                {snapshot.accounts.find((account) => account.id === variant.accountId)?.platform ===
                "youtube" ? (
                  <>
                    <label>
                      Video başlığı
                      <TextField
                        hideLabel
                        label=""
                        required
                        maxLength={100}
                        value={variant.youtube?.title ?? ""}
                        onChange={(event) =>
                          update(variant.accountId, {
                            youtube: {
                              ...youtubeDefaults,
                              ...variant.youtube,
                              title: event.target.value,
                            },
                          })
                        }
                      />
                    </label>
                    <label>
                      Video görünürlüğü
                      <NativeSelect
                        value={variant.youtube?.privacy ?? "private"}
                        onChange={(event) =>
                          update(variant.accountId, {
                            youtube: {
                              ...youtubeDefaults,
                              ...variant.youtube,
                              privacy: event.target.value as "private" | "unlisted" | "public",
                            },
                          })
                        }
                      >
                        <option value="private">Özel</option>
                        <option value="unlisted">Liste dışı</option>
                        <option value="public">Herkese açık</option>
                      </NativeSelect>
                    </label>
                    <fieldset className="social-checks">
                      <legend>İçerik beyanı</legend>
                      <label>
                        <Checkbox
                          checked={variant.youtube?.madeForKids ?? false}
                          onChange={(event) =>
                            update(variant.accountId, {
                              youtube: {
                                ...youtubeDefaults,
                                ...variant.youtube,
                                madeForKids: event.target.checked,
                              },
                            })
                          }
                        />
                        Çocuklara yönelik içerik
                      </label>
                      <label>
                        <Checkbox
                          checked={variant.youtube?.containsSyntheticMedia ?? false}
                          onChange={(event) =>
                            update(variant.accountId, {
                              youtube: {
                                ...youtubeDefaults,
                                ...variant.youtube,
                                containsSyntheticMedia: event.target.checked,
                              },
                            })
                          }
                        />
                        Gerçekçi değiştirilmiş veya sentetik içerik içeriyor
                      </label>
                    </fieldset>
                    <label>
                      Videoyu host'a yükle · MP4/WebM, en fazla 64 MiB
                      <TextField
                        hideLabel
                        label=""
                        type="file"
                        accept="video/mp4,video/webm"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file)
                            void run(async () => {
                              setVideoProgress((current) => ({
                                ...current,
                                [variant.accountId]: 0,
                              }));
                              try {
                                const upload = await client.uploadVideo(file, (percent) =>
                                  setVideoProgress((current) => ({
                                    ...current,
                                    [variant.accountId]: percent,
                                  })),
                                );
                                update(variant.accountId, {
                                  media: [
                                    {
                                      kind: "video",
                                      uploadId: upload.uploadId,
                                    },
                                  ],
                                });
                              } finally {
                                setVideoProgress((current) => {
                                  const next = { ...current };
                                  delete next[variant.accountId];
                                  return next;
                                });
                              }
                            });
                        }}
                      />
                      {variant.media[0]?.uploadId ? "Video hosta yüklendi" : null}
                      {videoProgress[variant.accountId] !== undefined ? (
                        <span role="status">
                          Host'a yükleniyor: %{videoProgress[variant.accountId]}
                        </span>
                      ) : null}
                    </label>
                    <p className="social-muted">
                      Bu alanlar video açıklaması ve kanal yayını içindir. Topluluk gönderisi ve
                      özel mesaj desteklenmez. Yükleme kabulü, videonun işlenip izlenebilir olduğu
                      anlamına gelmez; sonuçtaki görünürlüğü kontrol edin.
                    </p>
                  </>
                ) : null}
                <label>
                  Bu hesaba özel içerik
                  <TextareaField
                    hideLabel
                    label=""
                    value={variant.text}
                    required
                    rows={4}
                    onChange={(event) => update(variant.accountId, { text: event.target.value })}
                  />
                  <small role="status">
                    {variantCount(variant)}
                    {variantLimit(variant) !== undefined ? ` / ${variantLimit(variant)}` : ""}{" "}
                    karakter · bağlantı dahildir
                  </small>
                  {variantLimit(variant) !== undefined &&
                  variantCount(variant) > variantLimit(variant)! ? (
                    <Notice kind="error">İçerik sınırını aşıyor. Kaydetmeden önce kısaltın.</Notice>
                  ) : null}
                </label>
                {snapshot.accounts.find((account) => account.id === variant.accountId)?.platform ===
                "tiktok" ? (
                  <TikTokPublishingFields
                    variant={variant}
                    client={client}
                    onChange={(patch) => update(variant.accountId, patch)}
                  />
                ) : null}
                <details className="social-settings">
                  <summary>Tek seferlik yayın zamanı, medya ve bağlantı</summary>
                  <label>
                    Bağlantı
                    <TextField
                      hideLabel
                      label=""
                      type="url"
                      placeholder="https://"
                      value={variant.link ?? ""}
                      onChange={(event) =>
                        update(variant.accountId, {
                          link: event.target.value || undefined,
                        })
                      }
                    />
                  </label>
                  <label>
                    Tek seferlik planlama zamanı · bu bilgisayarın saat dilimi
                    <TextField
                      hideLabel
                      label=""
                      type="datetime-local"
                      required
                      value={dateInput(variant.scheduledAt)}
                      onChange={(event) =>
                        update(variant.accountId, {
                          scheduledAt: new Date(event.target.value).getTime(),
                        })
                      }
                    />
                  </label>
                  {!snapshot.accounts.some(
                    (account) =>
                      account.id === variant.accountId &&
                      ["youtube", "tiktok"].includes(account.platform),
                  ) ? (
                    <label>
                      HTTPS görsel URL
                      <TextField
                        hideLabel
                        label=""
                        type="url"
                        placeholder="https://"
                        value={variant.media[0]?.url ?? ""}
                        onChange={(event) =>
                          update(variant.accountId, {
                            media: event.target.value
                              ? [{ kind: "image", url: event.target.value }]
                              : [],
                          })
                        }
                      />
                    </label>
                  ) : null}
                  {snapshot.accounts.find((account) => account.id === variant.accountId)
                    ?.platform === "x" ? (
                    <XMediaFields
                      value={variant.media}
                      client={client}
                      onChange={(media) => update(variant.accountId, { media })}
                      onBusyChange={(busy) =>
                        setVideoProgress((current) => {
                          const next = { ...current };
                          if (busy) next[variant.accountId] = 0;
                          else delete next[variant.accountId];
                          return next;
                        })
                      }
                    />
                  ) : null}
                  {snapshot.accounts.some(
                    (account) =>
                      account.id === variant.accountId &&
                      account.platform === "linkedin" &&
                      account.accountType === "organization",
                  ) ? (
                    <label>
                      Görseli host'a yükle
                      <TextField
                        hideLabel
                        label=""
                        type="file"
                        accept="image/jpeg,image/png"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file)
                            void run(async () => {
                              const upload = await client.upload(file);
                              update(variant.accountId, {
                                media: [{ kind: "image", uploadId: upload.uploadId }],
                              });
                            });
                        }}
                      />
                      {variant.media[0]?.uploadId ? "Görsel hosta yüklendi" : null}
                    </label>
                  ) : null}
                  <label>
                    Doğrulanmış bilgi
                    <SearchableSelect
                      value=""
                      label={"Doğrulanmış bilgi"}
                      options={[
                        { value: "", label: "İçeriğe bilgi ekle" },
                        ...publicFacts.map((fact) => ({
                          value: fact.id,
                          label: [fact.topic, ":", fact.text].join(" "),
                        })),
                      ]}
                      onChange={(nextValue) => {
                        const fact = publicFacts.find((item) => item.id === nextValue);
                        if (fact)
                          update(variant.accountId, {
                            text: [variant.text, fact.text].filter(Boolean).join("\n"),
                            factIds: [...new Set([...variant.factIds, fact.id])],
                          });
                      }}
                      searchLocale="tr"
                    />
                  </label>
                  {variant.media.length ? (
                    <Button
                      variant="secondary"
                      type="button"
                      onClick={() => update(variant.accountId, { media: [] })}
                    >
                      Eklenen medyayı kaldır
                    </Button>
                  ) : null}
                </details>
                {!hasDraftAccess(variant.accountId) ? (
                  <Notice kind="error">
                    Bu hesaba seçili tüm projeler için taslak erişimi verin veya hesabı kaldırın.
                  </Notice>
                ) : null}
                {variant.factIds.some((id) => !publicFacts.some((fact) => fact.id === id)) ? (
                  <Notice kind="warning">
                    İçerikteki doğrulanmış bilgi seçili projelerin dışında. İlgili projeyi yeniden
                    seçin veya kampanyayı yeniden hazırlayın.
                  </Notice>
                ) : null}
                <Button
                  variant="secondary"
                  type="button"
                  onClick={() =>
                    setVariants((current) =>
                      current.filter((item) => item.accountId !== variant.accountId),
                    )
                  }
                >
                  Bu hesabı kampanyadan çıkar
                </Button>
              </fieldset>
            ))}
            <p className="social-muted">
              Düzenli paylaşım için bu taslağı Otomasyonlar bölümünde bir yayın planına
              ekleyebilirsiniz.
            </p>
            <Button
              type="submit"
              variant="secondary"
              disabled={
                !name.trim() ||
                !variants.length ||
                !validProjects ||
                invalidVariants ||
                Object.keys(videoProgress).length > 0
              }
            >
              Kampanya taslağını kaydet
            </Button>
            {!name.trim() || !variants.length || !validProjects ? (
              <small className="social-muted">
                Kaydetmek için kampanya adını, projeyi, hesabı ve içeriği tamamlayın.
              </small>
            ) : invalidVariants ? (
              <Notice kind="warning">
                İçerik, karakter sınırı, hesap erişimi veya planlama zamanını kontrol edin.
              </Notice>
            ) : Object.keys(videoProgress).length ? (
              <Notice kind="loading">Video yüklemesi bitince kaydedebilirsiniz.</Notice>
            ) : null}
            {editingId ? (
              <Button
                variant="secondary"
                type="button"
                onClick={(event) => {
                  setEditingId(undefined);
                  setName("");
                  setVariants([]);
                  closeComposer(event.currentTarget.closest("form")!);
                }}
              >
                Düzenlemeyi bırak
              </Button>
            ) : null}
          </form>
        </Composer>
        <div className="social-columns">
          <section>
            <h2 className="sr-only">
              Kampanyalar <small>{snapshot.campaigns.length}</small>
            </h2>
            <div className="social-list-tools">
              <label>
                Kampanya ara
                <SearchInput
                  appearance="field"
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Kampanya adı"
                />
              </label>
              <SocialFilters activeCount={statusFilter ? 1 : 0} onReset={() => setStatusFilter("")}>
                <label>
                  Durum
                  <NativeSelect
                    value={statusFilter}
                    onChange={(event) => setStatusFilter(event.target.value)}
                  >
                    <option value="">Tüm kampanyalar</option>
                    <option value="draft">Taslak</option>
                    <option value="queued">Planlandı</option>
                    <option value="running">Gönderiliyor</option>
                    <option value="succeeded">Gönderildi</option>
                    <option value="partial">Kısmen gönderildi</option>
                    <option value="failed">Başarısız</option>
                    <option value="review">İnceleme gerekli</option>
                    <option value="paused">Durduruldu</option>
                    <option value="cancelled">İptal edildi</option>
                  </NativeSelect>
                </label>
              </SocialFilters>
            </div>
            {snapshot.campaigns.length ? (
              visibleCampaigns.map((campaign) => (
                <Button
                  type="submit"
                  variant="tab"
                  className="social-row"
                  aria-pressed={selectedId === campaign.id}
                  key={campaign.id}
                  onClick={() => {
                    setSelectedId(campaign.id);
                    setPreview(null);
                    setApprovalConfirmed(false);
                  }}
                >
                  <strong>{campaign.name}</strong>
                  <StatusBadge
                    status={campaignState(campaign, snapshot.jobs, snapshot.campaignStates)}
                    label={
                      campaignState(campaign, snapshot.jobs, snapshot.campaignStates) === "partial"
                        ? "Kısmen gönderildi"
                        : undefined
                    }
                  />
                  <span>
                    {campaign.projectIds.length} proje · {campaign.variants.length} hesap
                  </span>
                </Button>
              ))
            ) : (
              <Empty title="İlk kampanyanızı hazırlayın">
                Yeni kampanya ile proje ve hesapları seçip içeriğinizi hazırlayın.
              </Empty>
            )}
            {snapshot.campaigns.length && !visibleCampaigns.length ? (
              <Empty title="Eşleşen kampanya yok">Aramayı veya durum filtresini değiştirin.</Empty>
            ) : null}
          </section>
          <section>
            {selected ? (
              <>
                <header className="social-record-heading">
                  <div>
                    <h2>{selected.name}</h2>
                    <span className="social-muted">
                      {selected.projectIds
                        .map((id) => projects.find((project) => project.id === id)?.name || "Proje")
                        .join(", ")}
                    </span>
                  </div>
                  <StatusBadge
                    status={campaignState(selected, snapshot.jobs, snapshot.campaignStates)}
                    label={
                      campaignState(selected, snapshot.jobs, snapshot.campaignStates) === "partial"
                        ? "Kısmen gönderildi"
                        : undefined
                    }
                  />
                </header>
                <div className="social-campaign-content">
                  <div className="social-campaign-previews">
                    {selected.variants.map((variant) => (
                      <article className="social-preview" key={variant.accountId}>
                        <h3>
                          {snapshot.accounts.find((account) => account.id === variant.accountId)
                            ?.name ?? "Hesap kaldırıldı"}
                        </h3>
                        {variant.youtube ? (
                          <p>
                            {variant.youtube.title} · Görünürlük:{" "}
                            {variant.youtube.privacy === "private"
                              ? "Özel"
                              : variant.youtube.privacy === "unlisted"
                                ? "Liste dışı"
                                : "Herkese açık"}{" "}
                            · Çocuklara yönelik: {variant.youtube.madeForKids ? "Evet" : "Hayır"} ·
                            Sentetik içerik:{" "}
                            {variant.youtube.containsSyntheticMedia ? "Evet" : "Hayır"}
                          </p>
                        ) : null}
                        <p className="social-message">{variant.text}</p>
                        {variant.media.map((media, index) => (
                          <p key={index}>
                            {media.kind === "video" ? "Video" : "Görsel"}:{" "}
                            {media.url ?? "Hosta yüklenen dosya"}
                          </p>
                        ))}
                        {variant.link ? <p className="social-message">{variant.link}</p> : null}
                        <small>Tek seferlik yayın: {time(variant.scheduledAt)}</small>
                        {currentPreview?.targets
                          .filter((target) => target.accountId === variant.accountId)
                          .map((target) => (
                            <div key={target.accountId} className="social-inline-meta">
                              <StatusBadge
                                status={target.contentError ? "failed" : target.capability.status}
                                label={target.contentError ? "İçerik sorunu" : undefined}
                              />
                              <StatusBadge
                                status={target.approved ? "approved" : "draft"}
                                label={target.approved ? "İçerik onaylı" : "Onay bekliyor"}
                              />
                              {target.contentError || target.capability.status !== "available" ? (
                                <Notice kind="warning">
                                  {target.contentError || target.capability.reason}
                                </Notice>
                              ) : null}
                            </div>
                          ))}
                      </article>
                    ))}
                  </div>
                  <aside className="social-campaign-controls">
                    <section className="social-workflow-steps" aria-label="Yayın onayı ve planlama">
                      <h3>Kontrol et ve yayınla</h3>
                      {currentPreview && canApprove ? (
                        <label className="social-check">
                          <Checkbox
                            checked={approvalConfirmed}
                            onChange={(event) => setApprovalConfirmed(event.target.checked)}
                          />
                          Bu kampanyanın tüm hesap içeriklerini okudum ve yayınlanmasını
                          onaylıyorum.
                        </label>
                      ) : null}
                      <div className="social-actions">
                        <Button
                          type="submit"
                          variant={currentPreview ? "secondary" : "primary"}
                          onClick={() =>
                            void run(async () => {
                              setPreview(
                                await client.request("campaigns.preview", {
                                  id: selected.id,
                                }),
                              );
                              setApprovalConfirmed(false);
                            }, "Hesap ve içerik kontrolü tamamlandı.")
                          }
                        >
                          Hesap ve içeriği kontrol et
                        </Button>

                        <Button
                          type="submit"
                          variant={canApprove && !approved ? "primary" : "secondary"}
                          disabled={!canApprove || !approvalConfirmed || approved}
                          onClick={() =>
                            void run(async () => {
                              await client.request("campaigns.approve", { id: selected.id });
                              setPreview(
                                await client.request("campaigns.preview", { id: selected.id }),
                              );
                            }, "İçerik onaylandı. Tek seferlik planlayabilir veya otomatik yayın planına ekleyebilirsiniz.")
                          }
                        >
                          {approved ? "İçerik onaylandı" : "Yayın onayı ver"}
                        </Button>
                        <Button
                          type="submit"
                          variant={approved ? "primary" : "secondary"}
                          disabled={!canSchedule}
                          onClick={() =>
                            void run(async () => {
                              await client.request("campaigns.schedule", {
                                id: selected.id,
                              });
                            }, "Tek seferlik yayınlar planlandı. Sonuçları aşağıdan veya İşlem geçmişinden takip edin.")
                          }
                        >
                          Yayını planla
                        </Button>
                      </div>
                      {scheduleReason ? (
                        <Notice kind={currentPreview && !canApprove ? "warning" : "info"}>
                          {scheduleReason}
                        </Notice>
                      ) : null}
                    </section>
                    <div className="social-actions">
                      <Button
                        type="submit"
                        variant="secondary"
                        onClick={() =>
                          void run(
                            () =>
                              client.request("campaigns.pause", {
                                id: selected.id,
                                paused: !snapshot.campaigns.find(
                                  (campaign) => campaign.id === selected.id,
                                )?.paused,
                              }),
                            selected.paused ? "Kampanya devam ettirildi." : "Kampanya durduruldu.",
                          )
                        }
                      >
                        {selected.paused ? "Kampanyayı devam ettir" : "Kampanyayı durdur"}
                      </Button>
                      <Button
                        type="submit"
                        variant="secondary"
                        disabled={editBlocked}
                        onClick={() => {
                          setEditVersion((value) => value + 1);
                          setEditingId(selected.id);
                          setName(selected.name);
                          setSelectedProjects(selected.projectIds);
                          setVariants(
                            selected.variants.map((variant) => ({
                              ...variant,
                              media: [...variant.media],
                              factIds: [...variant.factIds],
                            })),
                          );
                        }}
                      >
                        Taslağı düzenle
                      </Button>
                    </div>
                    {editBlocked ? (
                      <small className="social-muted">
                        Planlanan, gönderilen veya incelemedeki yayınlar bu taslağın düzenlenmesini
                        engelliyor. Yeni içerik için yeni kampanya oluşturun.
                      </small>
                    ) : null}
                  </aside>
                </div>
                <details className="social-campaign-results">
                  <summary>
                    Yayın sonuçları <small>{selectedJobs.length}</small>
                  </summary>
                  <JobList snapshot={snapshot} campaignId={selected.id} client={client} run={run} />
                </details>
              </>
            ) : (
              <Empty title="Kampanya önizlemesi">
                İçeriği, yayın zamanını ve her hesabın sonucunu görmek için bir kampanya seçin.
              </Empty>
            )}
          </section>
        </div>
      </div>
      <section className="social-page-secondary">
        <ProjectProfile
          client={client}
          profiles={snapshot.profiles}
          projects={projects}
          initialProject={initialProject}
          run={run}
        />
      </section>
    </div>
  );
}
function ProjectProfile({
  client,
  profiles,
  projects,
  initialProject,
  run,
}: {
  client: SocialClient;
  profiles: SocialProjectProfile[];
  projects: HostProject[];
  initialProject?: string;
  run: Run;
}) {
  const [projectId, setProjectId] = useState(initialProject ?? projects[0]?.id ?? "");
  const activeProject = projects.some((project) => project.id === projectId)
    ? projectId
    : (projects[0]?.id ?? "");
  const profile = profiles.find((item) => item.projectId === activeProject);
  type ProfileDraft = {
    productName?: string;
    voice?: string;
    topic?: string;
    text?: string;
    source?: string;
    factId?: string;
  };
  const [drafts, setDrafts] = useState<Record<string, ProfileDraft>>({});
  const draft = drafts[activeProject] ?? {};
  const productName = draft.productName ?? profile?.productName ?? "";
  const voice = draft.voice ?? profile?.brandVoice ?? "";
  const updateDraft = (change: ProfileDraft) =>
    setDrafts((current) => ({
      ...current,
      [activeProject]: { ...current[activeProject], ...change },
    }));
  const save = (facts: SocialProjectProfile["facts"]) =>
    client.request("profiles.save", {
      projectId: activeProject,
      productName,
      brandVoice: voice,
      facts,
    });
  return (
    <details className="social-form">
      <summary>Ürün bilgisi ve doğrulanmış duyurular</summary>
      <p className="social-muted">
        Kampanyalara ekleyeceğiniz ve otomatik yanıtlarda kullanılacak doğrulanmış ürün bilgileri.
      </p>
      <label>
        Proje
        <SearchableSelect
          value={activeProject}
          disabled={!projects.length}
          label={"Proje"}
          options={[
            ...(!projects.length ? [{ value: "", label: "Proje bulunamadı" }] : []),
            ...projects.map((project) => ({
              value: project.id,
              label: project.name || project.cwd,
            })),
          ]}
          onChange={(nextValue) => setProjectId(nextValue)}
          searchLocale="tr"
        />
      </label>
      <form
        className="social-form"
        onSubmit={(event) => {
          field(event);
          void run(() => save(profile?.facts ?? []), "Ürün profili kaydedildi.");
        }}
      >
        <h3>Ürün profili</h3>
        <label>
          Ürün adı
          <TextField
            hideLabel
            label=""
            required
            maxLength={200}
            value={productName}
            onChange={(event) => updateDraft({ productName: event.target.value })}
          />
        </label>
        <label>
          Marka dili
          <TextField
            hideLabel
            label=""
            required
            maxLength={1000}
            value={voice}
            placeholder="Örn. kısa, açık ve samimi"
            onChange={(event) => updateDraft({ voice: event.target.value })}
          />
        </label>
        <Button type="submit" variant="secondary" disabled={!activeProject}>
          Ürün profilini kaydet
        </Button>
      </form>
      <form
        className="social-form"
        onSubmit={(event) => {
          field(event);
          const fact = {
            id: draft.factId ?? crypto.randomUUID(),
            topic: draft.topic ?? "",
            text: draft.text ?? "",
            source: draft.source ?? "",
            verifiedAt: Date.now(),
          };
          const facts = draft.factId
            ? (profile?.facts ?? []).map((item) => (item.id === draft.factId ? fact : item))
            : [...(profile?.facts ?? []), fact];
          void (async () => {
            if (await run(() => save(facts), "Doğrulanmış ürün bilgisi kaydedildi."))
              updateDraft({
                topic: "",
                text: "",
                source: "",
                factId: undefined,
              });
          })();
        }}
      >
        <h3>{draft.factId ? "Doğrulanmış bilgiyi düzenle" : "Doğrulanmış bilgi ekle"}</h3>
        <label>
          Bilgi konusu
          <TextField
            hideLabel
            label=""
            required
            maxLength={200}
            value={draft.topic ?? ""}
            onChange={(event) => updateDraft({ topic: event.target.value })}
          />
        </label>
        <label>
          Doğrulanmış, duyurulabilir bilgi
          <TextareaField
            hideLabel
            label=""
            required
            maxLength={4000}
            value={draft.text ?? ""}
            onChange={(event) => updateDraft({ text: event.target.value })}
          />
        </label>
        <label>
          Doğrulama kaynağı
          <TextField
            hideLabel
            label=""
            required
            maxLength={1000}
            value={draft.source ?? ""}
            onChange={(event) => updateDraft({ source: event.target.value })}
          />
        </label>
        <Button
          type="submit"
          variant="secondary"
          disabled={
            !activeProject ||
            !productName.trim() ||
            !voice.trim() ||
            (!draft.factId && (profile?.facts.length ?? 0) >= 100)
          }
        >
          Herkese açık bilgiyi kaydet
        </Button>
        {draft.factId ? (
          <Button
            variant="secondary"
            type="button"
            onClick={() =>
              updateDraft({
                topic: "",
                text: "",
                source: "",
                factId: undefined,
              })
            }
          >
            Düzenlemeyi bırak
          </Button>
        ) : null}
      </form>
      {!profile?.facts.length ? (
        <Empty>
          Kayıtlı ürün bilgisi yok. Otomatik yanıt hazırlamak için doğrulanmış bir bilgi ekleyin.
        </Empty>
      ) : null}
      {profile?.facts.map((fact) => (
        <p key={fact.id}>
          <strong>{fact.topic}</strong> · {fact.text}
          <small>
            {" "}
            {fact.source} · {time(fact.verifiedAt)}
          </small>
          <Button
            variant="secondary"
            type="button"
            onClick={() =>
              updateDraft({
                factId: fact.id,
                topic: fact.topic,
                text: fact.text,
                source: fact.source,
              })
            }
          >
            Bilgiyi düzenle
          </Button>
        </p>
      ))}
    </details>
  );
}
