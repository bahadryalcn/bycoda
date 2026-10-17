import { Badge } from "../../../shared/ui/Badge";
import { NativeSelect } from "../../../shared/ui/Select";
import { Button } from "../../../shared/ui/Button";
import { Skeleton } from "../../../shared/ui/Skeleton";
import { t } from "../../../shared/i18n";
import { TextField } from "../../../shared/ui/TextField";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useQueryVisible } from "../../../shared/hooks/useQueryVisible";
import { socialQueryScope } from "../model/socialQuery";
import { SocialPanelActiveContext } from "./socialContext";
import { ToolHeader } from "../../../app/shell/ToolNavigation";
import { Campaigns } from "./SocialCampaigns";
import { Audience, Rules } from "./SocialManagement";
import { Inbox } from "./SocialInbox";
import { PublishingPlans } from "./SocialPublishingPlans";
import { SocialPrograms } from "./SocialPrograms";
import { SocialHistory } from "./SocialHistory";
import { SocialSendingControls } from "./SocialSendingControls";
import { RetainedSocialPanel } from "./RetainedSocialPanel";
import {
  Empty,
  Notice,
  StatusBadge,
  Composer,
  closeComposer,
  Projects,
  field,
  names,
  operations,
  type Run,
  type Props,
} from "./socialShared";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { remoteRequest } from "../../connections/model/connections";
import { isLocalSyncMachine } from "../../connections/model/localSync";
import type { HostProject, RemoteMachine } from "../../connections/model/protocol";
import { pathKey } from "../../../shared/lib/paths";
import { socialClient } from "../model/socialClient";
import {
  SOCIAL_PLATFORMS,
  type SocialAccount,
  type SocialSnapshot,
  type SocialOperation,
  type SocialCollection,
  type SocialWorkspaceQuery,
  type SocialWorkspaceResponse,
  type SocialWorkspaceFilters,
  type SocialCollectionFilter,
} from "../model/social";
import "./social.css";
import { OverlayNav } from "../../../app/shell/TitleBar";
import { WindowControls } from "../../../app/shell/WindowControls";
import { IS_MAC } from "../../../platform/tauri/platform";
import {
  Globe,
  RefreshCw,
  X,
  Link,
  Share,
  Inbox as InboxIcon,
  MessageMultiple,
  Zap,
  Settings,
} from "../../../shared/ui/icons";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { accountConnectionStatus } from "../model/accountConnection";
import { SocialAuthority } from "./SocialAuthority";
import { SocialPolicySettings } from "./SocialPolicySettings";
import { DEFAULT_SOCIAL_POLICIES } from "../model/socialPolicy";
import {
  createRefreshScheduler,
  type RefreshScheduler,
} from "../../automations/model/refreshScheduler";
import type { SocialClient } from "../model/socialClient";
import { scopeSocialSnapshot } from "../model/socialWorkspace";

type Tab = "Hesaplar" | "Kampanyalar" | "Gelen Kutusu" | "Hedef Kitle" | "Otomasyonlar" | "Ayarlar";
const tabs: Tab[] = [
  "Hesaplar",
  "Kampanyalar",
  "Gelen Kutusu",
  "Hedef Kitle",
  "Otomasyonlar",
  "Ayarlar",
];
type Section = NonNullable<SocialWorkspaceQuery["section"]>;
function workspaceSection(tab: Tab, automationMode: string): Section {
  if (tab === "Otomasyonlar")
    return (
      (
        { publish: "plans", reply: "rules", history: "history", sending: "sending" } as Record<
          string,
          Section
        >
      )[automationMode] ?? "plans"
    );
  return (
    {
      Hesaplar: "accounts",
      Kampanyalar: "campaigns",
      "Gelen Kutusu": "inbox",
      "Hedef Kitle": "audience",
      Ayarlar: "settings",
    } as const
  )[tab];
}
type HostWorkspaceState = {
  machineId: string;
  snapshots: Map<Section, SocialSnapshot>;
  cursors: Map<string, SocialWorkspaceResponse>;
  projects: HostProject[];
  projectsLoaded: boolean;
  snapshot: SocialSnapshot | null;
  tab: Tab;
  visited: Tab[];
  filter: string;
  offsets: SocialWorkspaceQuery["offsets"];
  automationMode: string;
  collectionFilters: Partial<Record<Section, SocialWorkspaceFilters>>;
  client?: SocialClient;
  run?: Run;
};
const tabIcons = {
  Hesaplar: Link,
  Kampanyalar: Share,
  "Gelen Kutusu": InboxIcon,
  "Hedef Kitle": MessageMultiple,
  Otomasyonlar: Zap,
  Ayarlar: Settings,
};
const actionMessages: Record<string, string> = {
  "accounts.create": "Hesap eklendi. Bağlantıyı tamamlayın.",
  "accounts.grant": "Proje izinleri kaydedildi.",
  "accounts.pause": "Hesabın çalışma durumu güncellendi.",
  "accounts.disconnect": "Hesap bağlantısı kaldırıldı.",
  "campaigns.create": "Kampanya taslağı kaydedildi.",
  "campaigns.update": "Kampanya güncellendi. Güncel içeriği yeniden onaylayın.",
  "campaigns.approve": "Kampanya içeriği onaylandı.",
  "campaigns.schedule": "Paylaşım kuyruğa alındı. Sonucunu İşlem geçmişinden izleyin.",
  "campaigns.pause": "Kampanyanın çalışma durumu güncellendi.",
  "contacts.upsert": "Kişi bilgileri kaydedildi.",
  "contacts.import": "Kişiler içe aktarıldı.",
  "segments.create": "Kişi grubu oluşturuldu.",
  "replies.draft": "Yanıt taslağı hazır. Kontrol edip onaylayabilirsiniz.",
  "messages.draft": "Mesaj taslağı hazır. Kontrol edip onaylayabilirsiniz.",
  "comments.draft": "Yorum taslağı hazır. Kontrol edip onaylayabilirsiniz.",
  "drafts.update": "Taslak güncellendi; önceki gönderim onayı kaldırıldı.",
  "drafts.approve": "Taslak onaylandı. Gönderim için hazır.",
  "replies.send": "Yanıt kuyruğa alındı. Gönderim sonucunu İşlem geçmişinden izleyin.",
  "messages.send": "Mesaj kuyruğa alındı. Gönderim sonucunu İşlem geçmişinden izleyin.",
  "comments.send": "Yorum kuyruğa alındı. Gönderim sonucunu İşlem geçmişinden izleyin.",
  "jobs.cancel": "Kuyruktaki iş iptal edildi.",
  "jobs.retry": "Başarısız iş yeniden kuyruğa alındı.",
  "thread.assign": "Konuşmanın projesi güncellendi.",
  "policy.update": "Ajan ve içerik sınırları kaydedildi.",
  "automations.create": "Yanıt kuralı kaydedildi. Hazır olduğunuzda etkinleştirin.",
  "automations.activate": "Yanıt kuralı etkinleştirildi.",
  "automations.pause": "Yanıt kuralı durduruldu.",
};
export function SocialView({
  cwd,
  onClose,
  besideRail = false,
  compactRail = false,
  onToggleSidebar = () => {},
}: {
  cwd: string;
  besideRail?: boolean;
  compactRail?: boolean;
  onToggleSidebar?: () => void;
  onClose: () => void;
}) {
  const [machines, setMachines] = useState<RemoteMachine[]>([]);
  const [machineId, setMachineId] = useState("");
  const [snapshot, setSnapshot] = useState<SocialSnapshot | null>(null);
  const [projects, setProjects] = useState<HostProject[]>([]);
  const [tab, setTab] = useState<Tab>("Hesaplar");
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [updatedAt, setUpdatedAt] = useState(0);
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [visited, setVisited] = useState<Tab[]>(["Hesaplar"]);
  const [automationMode, setAutomationMode] = useState("publish");
  const [filter, setFilter] = useState("");
  const [offsets, setOffsets] = useState<SocialWorkspaceQuery["offsets"]>({});
  const [collectionFilters, setCollectionFilters] = useState<
    Partial<Record<Section, SocialWorkspaceFilters>>
  >({});
  const hostWorkspaces = useRef(new Map<string, HostWorkspaceState>());
  const scheduler = useRef<RefreshScheduler | null>(null);
  const scheduledQuery = useRef("");
  const forceRefresh = useRef(false);
  const refreshProjects = useRef(false);
  const refreshSucceeded = useRef(false);
  const legacyHosts = useRef(new Set<string>());
  const section = workspaceSection(tab, automationMode);
  const query = useRef<SocialWorkspaceQuery>({ section });
  query.current = {
    section,
    ...(filter ? { projectId: filter } : {}),
    offsets,
    filters: collectionFilters[section] ?? {},
  };
  const running = useRef(false);
  const root = useRef<HTMLDivElement>(null);
  const epoch = useRef(0);
  const currentMachine = useRef(machineId);
  const lastAction = useRef("");
  const loadedMachine = useRef("");
  const retainedSnapshot = useRef(snapshot);
  retainedSnapshot.current = snapshot;
  currentMachine.current = machineId;
  const client = useMemo(() => {
    const base = socialClient(machineId);
    const request: typeof base.request = async <T,>(
      action: string,
      input?: Record<string, unknown>,
      requestId?: string,
    ) => {
      lastAction.current = action;
      return base.request<T>(action, input, requestId);
    };
    return { ...base, request };
  }, [machineId]);
  const readWorkspace = useCallback(async (id: string, isCurrent: () => boolean) => {
    const version = ++epoch.current;
    const host = hostWorkspaces.current.get(id)!;
    const input = query.current;
    const queryKey = JSON.stringify(input);
    const force = forceRefresh.current;
    const withProjects = refreshProjects.current || !host.projectsLoaded;
    forceRefresh.current = false;
    refreshProjects.current = false;
    const base = socialClient(id);
    const read = async (): Promise<SocialWorkspaceResponse> => {
      if (!legacyHosts.current.has(id)) {
        try {
          return await base.workspaceSnapshot({
            ...input,
            ...(force ? {} : { cursor: host.cursors.get(queryKey)?.cursor }),
          });
        } catch (value) {
          if (!String(value).includes("Unsupported social operation")) throw value;
          legacyHosts.current.add(id);
        }
      }
      return { cursor: "", unchanged: false, snapshot: await base.snapshot() };
    };
    if (force || !retainedSnapshot.current) setRefreshing(true);
    const answers = await Promise.allSettled([
      read(),
      withProjects
        ? remoteRequest<HostProject[]>(id, "projects.list", {})
        : Promise.resolve(host.projects),
    ]);
    if (!isCurrent() || version !== epoch.current || currentMachine.current !== id) return;
    setStale(answers.some((answer) => answer.status === "rejected"));
    if (answers[0].status === "fulfilled") {
      const result = answers[0].value;
      const next = result.snapshot ?? host.cursors.get(queryKey)?.snapshot;
      if (!next) throw new Error("Sosyal medya yenileme yanıtı eksik.");
      host.cursors.set(queryKey, { ...result, snapshot: next });
      if (host.cursors.size > 16) host.cursors.delete(host.cursors.keys().next().value!);
      host.snapshot = next;
      if (legacyHosts.current.has(id)) {
        for (const key of [
          "accounts",
          "campaigns",
          "inbox",
          "audience",
          "plans",
          "rules",
          "history",
          "sending",
          "settings",
        ] as Section[])
          host.snapshots.set(key, next);
      } else host.snapshots.set(input.section!, next);
      setSnapshot(next);
      setLoadError("");
      setUpdatedAt(Date.now());
    } else {
      setLoadError(String(answers[0].reason));
    }
    if (answers[1].status === "fulfilled") {
      host.projects = answers[1].value;
      host.projectsLoaded = true;
      setProjects(answers[1].value);
    } else setLoadError("Proje listesi yenilenemedi. Önceki veriler korunuyor; tekrar deneyin.");
    setLoading(false);
    setRefreshing(false);
    refreshSucceeded.current = answers.every((answer) => answer.status === "fulfilled");
  }, []);
  const refresh = useCallback(async (id: string, interactive = false, withProjects = false) => {
    if (id !== currentMachine.current || !scheduler.current) return false;
    forceRefresh.current ||= interactive;
    refreshProjects.current ||= interactive || withProjects;
    if (interactive) setRefreshing(true);
    await scheduler.current.refresh();
    return id === currentMachine.current && refreshSucceeded.current;
  }, []);
  useEffect(() => {
    let alive = true;
    if (!retainedSnapshot.current) setLoading(true);
    const previousFocus = document.activeElement as HTMLElement | null;
    const load = async () => {
      await invoke("local_host_connect").catch(() => undefined);
      const list = await invoke<RemoteMachine[]>("remote_machines");
      if (!alive) return;
      const authority = await invoke<{ authorityMachineId?: string }>(
        "social_authority_status",
      ).catch(() => null);
      if (!alive) return;
      setMachines(list);
      const saved = localStorage.getItem("bycoda.social.host");
      const preferred =
        list.find((machine) => machine.id === (authority?.authorityMachineId ?? saved)) ??
        list.find(isLocalSyncMachine) ??
        list[0];
      if (preferred) setMachineId(preferred.id);
      else
        setLoadError(
          "Sosyal Medya için bir bycoda Host bağlayın. Host çevrimdışıyken kuyruk çalışmaz.",
        );
    };
    void load()
      .catch((value) => alive && setLoadError(String(value)))
      .finally(() => alive && setLoading(false));
    if (!retainedSnapshot.current) root.current?.focus();
    return () => {
      alive = false;
      ++epoch.current;
      previousFocus?.focus();
    };
  }, [retryKey]);
  useEffect(() => {
    if (!machineId) return;
    localStorage.setItem("bycoda.social.host", machineId);
    if (loadedMachine.current !== machineId) {
      loadedMachine.current = machineId;
      let host = hostWorkspaces.current.get(machineId);
      if (!host) {
        host = {
          machineId,
          snapshots: new Map(),
          cursors: new Map(),
          projects: [],
          projectsLoaded: false,
          snapshot: null,
          tab: "Hesaplar",
          visited: ["Hesaplar"],
          filter: "",
          offsets: {},
          automationMode: "publish",
          collectionFilters: {},
        };
        hostWorkspaces.current.set(machineId, host);
      }
      retainedSnapshot.current = host.snapshot;
      setSnapshot(host.snapshot);
      setProjects(host.projects);
      setFilter(host.filter);
      setOffsets(host.offsets);
      setTab(host.tab);
      setVisited(host.visited);
      setAutomationMode(host.automationMode);
      setCollectionFilters(host.collectionFilters);
      query.current = {
        section: workspaceSection(host.tab, host.automationMode),
        ...(host.filter ? { projectId: host.filter } : {}),
        offsets: host.offsets,
        filters: host.collectionFilters[workspaceSection(host.tab, host.automationMode)] ?? {},
      };
      setError("");
      setLoadError("");
      setNotice("");
      setStale(false);
      setLoading(!host.snapshot);
      setUpdatedAt(0);
    }
    scheduledQuery.current = JSON.stringify(query.current);
    const nextScheduler = createRefreshScheduler({
      run: (isCurrent) =>
        document.hidden ? Promise.resolve() : readWorkspace(machineId, isCurrent),
      intervalMs: 15_000,
      hiddenIntervalMs: 60_000,
    });
    scheduler.current = nextScheduler;
    const onVisibility = () => nextScheduler.visibilityChanged();
    document.addEventListener("visibilitychange", onVisibility);
    nextScheduler.start();
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      nextScheduler.stop();
      ++epoch.current;
      if (scheduler.current === nextScheduler) scheduler.current = null;
    };
  }, [machineId, readWorkspace]);
  useEffect(() => {
    const key = JSON.stringify(query.current);
    if (!machineId || scheduledQuery.current === key) return;
    scheduledQuery.current = key;
    setRefreshing(true);
    void refresh(machineId);
  }, [machineId, tab, automationMode, filter, offsets, collectionFilters, refresh]);
  const run: Run = async (work, successMessage) => {
    if (running.current) return false;
    running.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    lastAction.current = "";
    const id = machineId;
    try {
      await work();
      const completedMessage =
        successMessage ??
        actionMessages[lastAction.current] ??
        "İşlem tamamlandı; sonuçlar güncellendi.";
      if (currentMachine.current === id) {
        const fresh = await refresh(id, false, true);
        setNotice(
          fresh
            ? completedMessage
            : `${completedMessage} Liste yenilenemedi; son veriler gösteriliyor.`,
        );
      }
      return true;
    } catch (value) {
      if (currentMachine.current === id)
        setError(value instanceof Error ? value.message : String(value));
      return false;
    } finally {
      setBusy(false);
      running.current = false;
    }
  };
  const activeProject = projects.find((project) => pathKey(project.cwd) === pathKey(cwd))?.id;
  const scoped = useMemo(() => scopeSocialSnapshot(snapshot, filter), [snapshot, filter]);
  const openHistory = () => {
    setTab("Otomasyonlar");
    setAutomationMode("history");
    setNotice("");
    setVisited((current) =>
      current.includes("Otomasyonlar") ? current : [...current, "Otomasyonlar"],
    );
  };
  const host = hostWorkspaces.current.get(machineId);
  if (host && loadedMachine.current === machineId) {
    Object.assign(host, {
      tab,
      visited,
      filter,
      offsets,
      automationMode,
      client,
      run,
      projects,
      collectionFilters,
    });
  }
  return (
    <div
      ref={root}
      tabIndex={-1}
      role="region"
      aria-labelledby="social-title"
      className="social-view"
      data-app-social
    >
      <div
        className="flex h-10 shrink-0 select-none items-center border-b border-stroke"
        data-tauri-drag-region="deep"
      >
        {IS_MAC && compactRail ? <div className="w-4 shrink-0" /> : null}
        {IS_MAC && !besideRail ? <div className="w-[78px] shrink-0" /> : null}
        {besideRail ? null : <OverlayNav onBack={onClose} onToggleSidebar={onToggleSidebar} />}
        <ToolHeader>
          <div className="flex min-w-0 flex-1 items-center gap-2 px-3 text-[13px]">
            <Globe className="size-3.5 text-(--ui-text-secondary)" aria-hidden />
            <span>Sosyal Medya</span>
          </div>
        </ToolHeader>
        {IS_MAC ? null : <WindowControls />}
      </div>
      <div className="social-layout">
        <header className="social-header">
          <div className="social-heading">
            <h1 id="social-title">{tab}</h1>
          </div>
          <div className="social-header-controls">
            <div className="social-header-field">
              <span>Bağlantı</span>
              <SearchableSelect
                value={machineId}
                disabled={busy}
                label={t("Yetkili host")}
                options={machines.map((machine) => ({
                  value: machine.id,
                  label: isLocalSyncMachine(machine) ? "Bu bilgisayar" : machine.name,
                }))}
                onChange={(nextValue) => setMachineId(nextValue)}
                searchLocale="tr"
              />
            </div>
            <div className="social-header-field social-project-filter">
              <span>Proje</span>
              <SearchableSelect
                label="Proje filtresi"
                value={filter}
                onChange={(next) => {
                  setFilter(next);
                  setOffsets({});
                }}
                options={[
                  { value: "", label: "Tüm projeler" },
                  ...projects.map((project) => ({
                    value: project.id,
                    label: project.name || project.cwd,
                    keywords: project.cwd,
                  })),
                ]}
                searchPlaceholder="Proje ara…"
                emptyLabel="Proje bulunamadı"
                disabled={busy}
              />
            </div>
            {activeProject && !filter ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  setFilter(activeProject);
                  setOffsets({});
                }}
              >
                Bu proje
              </Button>
            ) : null}
            <Button
              variant="secondary"
              size="sm"
              loading={busy || loading}
              type="button"
              onClick={openHistory}
            >
              İşlem geçmişi
            </Button>
          </div>
          <div className="social-header-actions">
            <Button
              type="button"
              iconOnly
              size="sm"
              label="Yenile"
              variant="ghost"
              loading={busy || refreshing}

              disabled={busy || refreshing || !machineId}
              aria-label="Yenile"
              title={refreshing ? "Yenileniyor…" : "Yenile"}
              data-refreshing={refreshing}
              onClick={() => {
                setNotice("");
                void refresh(machineId, true);
              }}
            >
              <RefreshCw className="size-4" aria-hidden="true" />
            </Button>
            <Button
              type="button"
              iconOnly
              size="sm"
              label="Sosyal Medya ekranını kapat"
              variant="ghost"

              aria-label="Sosyal Medya ekranını kapat"
              title="Sosyal Medya ekranını kapat"
              onClick={onClose}
            >
              <X className="size-4" aria-hidden="true" />
            </Button>
          </div>
        </header>
        <nav aria-label="Sosyal Medya bölümleri" className="social-tabs">
          {tabs.map((item) => {
            const Icon = tabIcons[item];
            return (
              <Button
                type="button"
                variant="tab"
                key={item}
                title={item}
                aria-current={tab === item ? "page" : undefined}
                onClick={() => {
                  setNotice("");
                  setError("");
                  setTab(item);
                  setVisited((current) => (current.includes(item) ? current : [...current, item]));
                }}
              >
                <Icon className="social-nav-icon" aria-hidden="true" />
                <span className="social-nav-label">{item}</span>
                {item !== "Ayarlar" && scoped ? (
                  <span aria-hidden="true" className="social-nav-count">
                    {
                      {
                        Hesaplar: scoped.accounts.length,
                        Kampanyalar: scoped.pages?.campaigns?.total ?? scoped.campaigns.length,
                        "Gelen Kutusu": scoped.pages?.threads?.total ?? scoped.threads.length,
                        "Hedef Kitle": scoped.pages?.contacts?.total ?? scoped.contacts.length,
                        Otomasyonlar:
                          (scoped.pages?.rules?.total ?? scoped.rules.length) +
                          (scoped.pages?.publishingPlans?.total ??
                            scoped.publishingPlans?.length ??
                            0),
                        Ayarlar: 0,
                      }[item]
                    }
                  </span>
                ) : null}
              </Button>
            );
          })}
        </nav>
        <div className="social-host-status" role="status">
          <span
            className="social-status-dot"
            data-online={snapshot?.hostOnline ?? false}
            aria-hidden="true"
          />
          <span className="social-host-label">
            {snapshot
              ? snapshot.hostOnline
                ? "Host çalışıyor"
                : "Host kuyruğu kapalı"
              : loading
                ? "Hesaplar yükleniyor…"
                : "Bağlantı kurulamadı"}
          </span>
          {snapshot ? (
            <Badge
              tone="neutral"
              size="sm"
              data-enabled={snapshot.sendingEnabled && !snapshot.stopped}
            >
              {snapshot.stopped
                ? "Gönderimler durduruldu"
                : snapshot.sendingEnabled
                  ? "Onaylı gönderimler açık"
                  : "Taslak modu · gönderim kapalı"}
            </Badge>
          ) : null}
          {snapshot ? (
            <Button
              variant="secondary"
              type="button"
              size="sm"
              onClick={() => {
                setTab("Otomasyonlar");
                setAutomationMode("sending");
                setVisited((current) =>
                  current.includes("Otomasyonlar") ? current : [...current, "Otomasyonlar"],
                );
              }}
            >
              Gönderim kontrolleri
            </Button>
          ) : null}
          <details className="social-status-details">
            <summary>Çalışma bilgisi</summary>
            <p>
              Host açıkken planlanan işler oturumdan bağımsız çalışır. Gönderim için içerik onayı
              veya etkin bir kural gerekir. Host kapalıyken işler yürütülmez.
            </p>
          </details>
          {updatedAt ? (
            <small className="social-updated-at">
              Son yenileme{" "}
              {new Date(updatedAt).toLocaleTimeString("tr-TR", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </small>
          ) : null}
          {refreshing && snapshot ? (
            <StatusBadge status="loading" label="Veriler yenileniyor" />
          ) : null}
          {stale && snapshot ? (
            <StatusBadge status="warning" label="Son veriler gösteriliyor" />
          ) : null}
        </div>
        {error || loadError ? (
          <div className="social-error social-feedback-bar">
            <Notice kind="error" title={error ? "İşlem tamamlanamadı" : "Bağlantı yenilenemedi"}>
              {error || loadError}
            </Notice>
            <Button
              type="button"
              variant="secondary"
              loading={busy}
              disabled={busy || loading}
              onClick={() => {
                if (error) setError("");
                else if (machineId) void refresh(machineId, true);
                else setRetryKey((value) => value + 1);
              }}
            >
              {error ? "Bildirimi kapat" : "Tekrar dene"}
            </Button>
          </div>
        ) : null}
        <main className="social-main" aria-busy={loading || busy || refreshing}>
          {busy || notice ? (
            <div className="social-feedback-bar">
              <Notice
                kind={busy ? "loading" : stale ? "warning" : "success"}
                title={busy ? "İşlem sürüyor…" : notice}
              />
            </div>
          ) : null}
          {scoped ? (
            <WorkspacePagination
              snapshot={scoped}
              section={section}
              disabled={busy || refreshing}
              onPage={(collection, offset) =>
                setOffsets((previous) => ({ ...previous, [collection]: offset }))
              }
            />
          ) : null}
          {Array.from(hostWorkspaces.current.entries()).map(([id, host]) =>
            host.client && host.run ? (
              <RetainedSocialPanel
                key={id}
                active={id === machineId}
                busy={busy}
                error={error}
                notice={notice}
              >
                <WorkspacePanels
                  host={host}
                  active={id === machineId}
                  machines={machines}
                  cwd={cwd}
                  busy={busy}
                  error={error}
                  notice={notice}
                  onOpenHistory={openHistory}
                  onSelect={setMachineId}
                  onNavigate={(next) => {
                    if (next === "Otomasyonlar") setAutomationMode("publish");
                    setTab(next);
                    setVisited((current) =>
                      current.includes(next) ? current : [...current, next],
                    );
                  }}
                  onAutomationMode={setAutomationMode}
                  onCollectionFilter={(targetSection, collection, next) => {
                    setCollectionFilters((previous) => ({
                      ...previous,
                      [targetSection]: { ...previous[targetSection], [collection]: next },
                    }));
                    setOffsets((previous) => ({ ...previous, [collection]: 0 }));
                  }}
                />
              </RetainedSocialPanel>
            ) : null,
          )}
          {!scoped || !hostWorkspaces.current.get(machineId)?.snapshots.has(section) ? (
            loading || refreshing || !!scoped ? (
              <div className="social-initial-loading">
                <Notice kind="loading" title="Sosyal medya çalışma alanı yükleniyor" />
                <Skeleton className="social-skeleton" aria-hidden="true" />
                <Skeleton className="social-skeleton" aria-hidden="true" />
              </div>
            ) : (
              <Empty title="Host bağlantısı gerekli">
                Bağlantıyı yenileyin veya bağlı bir host seçin.
              </Empty>
            )
          ) : null}
        </main>
      </div>
    </div>
  );
}
const sectionCollections: Record<Section, SocialCollection[]> = {
  accounts: [],
  campaigns: ["campaigns", "jobs"],
  inbox: ["threads", "drafts", "jobs"],
  audience: ["contacts", "threads", "drafts", "jobs"],
  plans: ["publishingPlans", "campaigns", "jobs"],
  rules: ["rules", "drafts", "jobs"],
  history: ["jobs"],
  sending: [],
  settings: [],
};
const collectionLabels: Record<SocialCollection, string> = {
  campaigns: "Kampanyalar",
  publishingPlans: "Paylaşım planları",
  threads: "Konuşmalar",
  contacts: "Kişiler",
  rules: "Yanıt kuralları",
  jobs: "İşlem geçmişi",
  drafts: "Taslaklar",
};
function WorkspacePagination({
  snapshot,
  section,
  disabled,
  onPage,
}: {
  snapshot: SocialSnapshot;
  section: Section;
  disabled: boolean;
  onPage: (collection: SocialCollection, offset: number) => void;
}) {
  return (
    <nav aria-label="Sosyal medya veri sayfaları" className="social-filter-tabs">
      {sectionCollections[section].map((collection) => {
        const page = snapshot.pages?.[collection];
        if (!page || (!page.offset && page.total <= page.limit)) return null;
        return (
          <div
            key={collection}
            role="group"
            aria-label={`${collectionLabels[collection]} sayfaları`}
          >
            <span>
              {collectionLabels[collection]} · {page.total ? page.offset + 1 : 0}–
              {Math.min(page.offset + page.limit, page.total)} / {page.total}
            </span>
            <Button
              variant="secondary"
              type="button"
              disabled={disabled || page.offset === 0}
              onClick={() => onPage(collection, Math.max(0, page.offset - page.limit))}
            >
              Önceki sayfa
            </Button>
            <Button
              variant="secondary"
              type="button"
              disabled={disabled || page.offset + page.limit >= page.total}
              onClick={() => onPage(collection, page.offset + page.limit)}
            >
              Sonraki sayfa
            </Button>
          </div>
        );
      })}
    </nav>
  );
}
function WorkspacePanels({
  host,
  active,
  machines,
  cwd,
  busy,
  error,
  notice,
  onNavigate,
  onOpenHistory,
  onSelect,
  onAutomationMode,
  onCollectionFilter,
}: {
  host: HostWorkspaceState;
  active: boolean;
  machines: RemoteMachine[];
  cwd: string;
  busy: boolean;
  error: string;
  notice: string;
  onNavigate: (tab: Tab) => void;
  onOpenHistory: () => void;
  onSelect: (id: string) => void;
  onAutomationMode: (mode: string) => void;
  onCollectionFilter: (
    section: Section,
    collection: SocialCollection,
    filter: SocialCollectionFilter,
  ) => void;
}) {
  const { tab, visited, filter, automationMode, projects } = host;
  const client = host.client!,
    run = host.run!;
  const initialProject =
    filter || projects.find((project) => pathKey(project.cwd) === pathKey(cwd))?.id;
  const feedback = { busy, error, notice };
  const props = (section: Section): Props => ({
    client,
    run,
    projects,
    initialProject,
    snapshot: scopeSocialSnapshot(host.snapshots.get(section)!, filter)!,
    onFilterChange: (collection, next) => onCollectionFilter(section, collection, next),
  });
  const present = (tab: Tab, section: Section) =>
    visited.includes(tab) && host.snapshots.has(section);
  return (
    <fieldset disabled={busy} className="social-workspace">
      {present("Hesaplar", "accounts") ? (
        <RetainedSocialPanel {...feedback} active={active && tab === "Hesaplar"}>
          <Accounts {...props("accounts")} onOpenHistory={onOpenHistory} onNavigate={onNavigate} />
        </RetainedSocialPanel>
      ) : null}
      {present("Kampanyalar", "campaigns") ? (
        <RetainedSocialPanel {...feedback} active={active && tab === "Kampanyalar"}>
          <Campaigns {...props("campaigns")} />
        </RetainedSocialPanel>
      ) : null}
      {present("Gelen Kutusu", "inbox") ? (
        <RetainedSocialPanel {...feedback} active={active && tab === "Gelen Kutusu"}>
          <Inbox {...props("inbox")} />
        </RetainedSocialPanel>
      ) : null}
      {present("Hedef Kitle", "audience") ? (
        <RetainedSocialPanel {...feedback} active={active && tab === "Hedef Kitle"}>
          <Audience {...props("audience")} />
        </RetainedSocialPanel>
      ) : null}
      {visited.includes("Otomasyonlar") ? (
        <RetainedSocialPanel {...feedback} active={active && tab === "Otomasyonlar"}>
          <div
            className="social-filter-tabs social-automation-nav"
            role="group"
            aria-label="Otomasyon türü"
          >
            {[
              ["publish", "Paylaşım planları"],
              ["reply", "Yanıt kuralları"],
              ["sending", "Gönderim kontrolleri"],
              ["history", "İşlem geçmişi"],
            ].map(([value, label]) => (
              <Button
                variant="tab"
                type="button"
                key={value}
                aria-pressed={automationMode === value}
                onClick={() => onAutomationMode(value)}
              >
                {label}
              </Button>
            ))}
          </div>
          {host.snapshots.has("plans") ? (
            <RetainedSocialPanel
              {...feedback}
              active={active && tab === "Otomasyonlar" && automationMode === "publish"}
            >
              <PublishingPlans {...props("plans")} />
              <SocialPrograms {...props("plans")} />
            </RetainedSocialPanel>
          ) : null}
          {host.snapshots.has("rules") ? (
            <RetainedSocialPanel
              {...feedback}
              active={active && tab === "Otomasyonlar" && automationMode === "reply"}
            >
              <Rules {...props("rules")} />
            </RetainedSocialPanel>
          ) : null}
          {host.snapshots.has("sending") ? (
            <RetainedSocialPanel
              {...feedback}
              active={active && tab === "Otomasyonlar" && automationMode === "sending"}
            >
              <SocialSendingControls {...props("sending")} />
            </RetainedSocialPanel>
          ) : null}
          {host.snapshots.has("history") ? (
            <RetainedSocialPanel
              {...feedback}
              active={active && tab === "Otomasyonlar" && automationMode === "history"}
            >
              <SocialHistory {...props("history")} />
            </RetainedSocialPanel>
          ) : null}
        </RetainedSocialPanel>
      ) : null}
      {present("Ayarlar", "settings") ? (
        <RetainedSocialPanel
          {...feedback}
          active={active && tab === "Ayarlar"}
          className="social-settings-page"
        >
          <SocialPolicySettings
            client={client}
            policies={host.snapshots.get("settings")?.policies ?? DEFAULT_SOCIAL_POLICIES}
            run={run}
          />
          <SocialAuthority
            machines={machines}
            selectedHost={host.machineId}
            projects={projects}
            run={run}
            onSelect={onSelect}
          />
        </RetainedSocialPanel>
      ) : null}
    </fieldset>
  );
}
function Collapsible({
  collapsed,
  summary,
  children,
}: {
  collapsed: boolean;
  summary: string;
  children: ReactNode;
}) {
  return collapsed ? (
    <details className="social-form">
      <summary>{summary}</summary>
      {children}
    </details>
  ) : (
    <>{children}</>
  );
}
function Accounts({
  client,
  snapshot,
  projects,
  initialProject,
  run,
  onNavigate,
  onOpenHistory,
}: Props & { onNavigate?: (tab: Tab) => void; onOpenHistory?: () => void }) {
  const [oauthOperations, setOAuthOperations] = useState<SocialOperation[]>(["publish"]);
  const [resourceId, setResourceId] = useState("");
  const [platform, setPlatform] = useState<SocialAccount["platform"]>("x");
  const [selectedProjects, setSelectedProjects] = useState<string[]>(
    initialProject ? [initialProject] : [],
  );
  const [selected, setSelected] = useState(() => snapshot.accounts[0]?.id ?? "");
  const [availabilityError, setAvailabilityError] = useState("");
  const [availability, setAvailability] = useState<
    Record<string, { configured: boolean; reason: string }>
  >({});
  const [browserAvailability, setBrowserAvailability] = useState<{
    available: boolean;
    reason: string;
  }>();
  const [browserRisk, setBrowserRisk] = useState(false);
  const [grantProject, setGrantProject] = useState(initialProject ?? projects[0]?.id ?? "");
  const [grantPermissions, setGrantPermissions] = useState<string[]>(
    () => snapshot.accounts[0]?.grants[initialProject ?? projects[0]?.id ?? ""] ?? [],
  );
  const [disconnecting, setDisconnecting] = useState(false);
  const retainedGrantAccount = useRef(selected);
  const retainedBrowserAccount = useRef("");
  useEffect(() => {
    let alive = true;
    void client
      .oauthAvailability()
      .then((value) => {
        if (alive) {
          setAvailability(value);
          setAvailabilityError("");
        }
      })
      .catch(() => {
        if (alive) setAvailabilityError("Bağlantı ayarları okunamadı. Yenile ile tekrar deneyin.");
      });
    return () => {
      alive = false;
    };
  }, [client.oauthAvailability, snapshot.accounts]);
  const account = snapshot.accounts.find((item) => item.id === selected);
  useEffect(() => {
    if (retainedGrantAccount.current !== account?.id) {
      retainedGrantAccount.current = account?.id ?? "";
      if (account) setGrantPermissions(account.grants[grantProject] ?? []);
      setDisconnecting(false);
    }
  }, [account?.id]);
  const browserAccount = account?.platform === "x" ? account.id : "";
  const queryClient = useQueryClient();
  const scope = socialQueryScope(client);
  const active = useContext(SocialPanelActiveContext);
  const visible = useQueryVisible();
  const oauthKey = [...scope, "oauth", selected];
  const browserKey = [...scope, "browser", browserAccount];
  type OAuth = Awaited<ReturnType<SocialClient["oauthStatus"]>>;
  type Browser = Awaited<ReturnType<SocialClient["browserStatus"]>>;
  const oauthQuery = useQuery<OAuth | null>({
    queryKey: oauthKey,
    queryFn: async ({ signal }) => {
      try {
        const value = await client.oauthStatus(selected);
        signal.throwIfAborted();
        return value;
      } catch {
        signal.throwIfAborted();
        return {
          status: "failed",
          candidates: [],
          error: "Bağlantı durumu okunamadı. Bağlantıyı kontrol et ile tekrar deneyin.",
        };
      }
    },
    enabled: active && visible && !!selected,
    staleTime: 5_000,
    refetchInterval: (query) => (query.state.data?.status === "waiting" ? 5_000 : false),
  });
  const browserQuery = useQuery<Browser | null>({
    queryKey: browserKey,
    queryFn: async ({ signal }) => {
      const value = await client.browserStatus(browserAccount);
      signal.throwIfAborted();
      return value;
    },
    enabled: active && visible && !!browserAccount,
    staleTime: 3_000,
    refetchInterval: (query) => (query.state.data?.status === "waiting" ? 3_000 : false),
  });
  const oauth = oauthQuery.data ?? null;
  const browser = browserQuery.data ?? null;
  const setOAuth = (value: OAuth | null) => queryClient.setQueryData(oauthKey, value);
  const setBrowser = (value: Browser | null) => queryClient.setQueryData(browserKey, value);
  const connectedSeen = useRef("");
  useEffect(() => {
    const connected = oauth?.status === "connected" || browser?.status === "connected";
    const key = `${scope[1]}:${selected}`;
    if (connected && connectedSeen.current !== key) {
      connectedSeen.current = key;
      if (!account?.connected) void run(async () => undefined);
    } else if (!connected) connectedSeen.current = "";
  }, [oauth?.status, browser?.status, selected, account?.connected, scope[1], run]);
  useEffect(() => {
    if (retainedBrowserAccount.current !== browserAccount) {
      retainedBrowserAccount.current = browserAccount;
      setBrowserRisk(false);
    }
    if (!browserAccount || !active || !visible) return;
    let alive = true;
    void client
      .browserAvailability()
      .then((value) => alive && setBrowserAvailability(value))
      .catch(
        () =>
          alive &&
          setBrowserAvailability({
            available: false,
            reason:
              "Seçili host tarayıcı oturumu bağlantısını desteklemiyor. Host'u güncelleyip Yenile düğmesine basın.",
          }),
      );
    return () => {
      alive = false;
    };
  }, [browserAccount, active, visible, client]);
  return (
    <div className="social-page">
      <p className="social-page-intro">
        Hesaplarınızı bağlayın, bağlantı durumunu ve proje erişimini tek yerden yönetin.
      </p>
      <Composer title="Hesap ekle">
        <form
          onSubmit={(event) => {
            const form = event.currentTarget;
            const data = field(event);
            void run(async () => {
              const created = await client.request<SocialAccount>("accounts.create", {
                platform,
                name: data.get("name"),
                accountType: data.get("type"),
                projectIds: selectedProjects,
              });
              setSelected(created.id);
              setOAuth(null);
            }).then((success) => {
              if (success) {
                form.reset();
                closeComposer(form);
              }
            });
          }}
          className="social-form"
        >
          <label>
            Platform
            <NativeSelect
              value={platform}
              onChange={(event) => setPlatform(event.target.value as SocialAccount["platform"])}
            >
              {SOCIAL_PLATFORMS.map((id) => (
                <option key={id} value={id}>
                  {names[id]}
                </option>
              ))}
            </NativeSelect>
          </label>
          <label>
            Hesap adı
            <TextField hideLabel label="" name="name" required maxLength={200} />
          </label>
          <label>
            Hesap türü
            <NativeSelect name="type" key={platform}>
              {(platform === "x"
                ? [["member", "Kullanıcı"]]
                : platform === "instagram"
                  ? [["professional", "Profesyonel"]]
                  : platform === "facebook"
                    ? [["page", "Sayfa"]]
                    : platform === "youtube"
                      ? [["channel", "Kanal"]]
                      : [
                          ["member", "Üye"],
                          ["organization", "Organizasyon"],
                        ]
              ).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </NativeSelect>
          </label>
          <Projects
            projects={projects}
            selected={selectedProjects}
            onChange={setSelectedProjects}
          />
          <Button variant="primary" type="submit">
            Hesap ekle
          </Button>
          {!selectedProjects.length ? (
            <small>
              Bir proje seçerseniz bu proje hesapta okuma ve taslak hazırlama izni alır.
            </small>
          ) : null}
        </form>
      </Composer>
      <div className="social-columns">
        <section>
          <h2>Bağlı hesaplar</h2>
          {!snapshot.accounts.length ? (
            <Empty title="İlk hesabınızı ekleyin" icon={Link}>
              Hesap ekle ile başlayın; ardından platform bağlantısını tamamlayın.
            </Empty>
          ) : null}
          <div className="social-list">
            {snapshot.accounts.map((item) => (
              <Button
                type="button"
                variant="tab"
                className="social-row"
                aria-pressed={selected === item.id}
                key={item.id}
                onClick={() => {
                  setSelected(item.id);
                  setOAuthOperations(["publish"]);
                  setResourceId("");
                  setGrantPermissions(item.grants[grantProject] ?? []);
                  setOAuth(null);
                  setBrowser(null);
                }}
              >
                <strong>{item.name}</strong>
                <span>
                  {names[item.platform]} ·{" "}
                  {availabilityError
                    ? "Bağlantı kontrolü gerekli"
                    : accountConnectionStatus(
                        item,
                        availability[item.platform],
                        item.id === selected ? oauth?.status : undefined,
                      )}
                  {item.paused ? " · Durduruldu" : ""}
                </span>
              </Button>
            ))}
          </div>
        </section>
        <section>
          {account ? (
            <>
              <h2>{account.name}</h2>
              <div className="social-account-overview">
                <StatusBadge
                  status={
                    account.paused ? "paused" : account.connected ? "connected" : "disconnected"
                  }
                />
                <span>
                  {names[account.platform]} ·{" "}
                  {account.connection === "browser" ? "Tarayıcı bağlantısı" : "API bağlantısı"}
                </span>
                {account.connected && onNavigate ? (
                  <div className="social-actions">
                    <Button
                      variant="primary"
                      type="button"

                      onClick={() => onNavigate("Otomasyonlar")}
                    >
                      Paylaşım planla
                    </Button>
                    <Button variant="secondary" type="button" onClick={onOpenHistory}>
                      Geçmişi gör
                    </Button>
                  </div>
                ) : null}
              </div>
              {account.platform === "x" ? (
                <div className="social-connection">
                  <strong>
                    {account.connected && account.connection === "browser"
                      ? "X hesabı bağlı"
                      : "X hesabını bağlayın"}
                  </strong>
                  <details>
                    <summary>Tarayıcı bağlantısı nasıl çalışır?</summary>
                    <p>
                      X API ücretli olduğu için hesabı kendi X oturumunuzla bağlayabilirsiniz.
                      Seçili host'ta ayrı bir Edge/Chrome penceresi açılır; X'e orada kendiniz giriş
                      yapıp pencereyi kapatırsınız. Şifreniz bycoda'ya girilmez. Onaylanan
                      gönderiler bu oturumla arka planda paylaşılır. Yalnız gönderi/görsel paylaşımı
                      ve gönderi ID'sine yanıt desteklenir; gelen kutusu ve DM okunmaz.
                    </p>
                  </details>
                  <Notice kind="warning" title="Tarayıcı bağlantısı için risk onayı">
                    Bu yöntem resmi değildir. X otomasyonu algılarsa hesabı kısıtlayabilir veya
                    askıya alabilir.
                  </Notice>
                  <label className="social-inline-check">
                    <Checkbox
                      checked={browserRisk}
                      onChange={(event) => setBrowserRisk(event.target.checked)}
                    />
                    Riski anlıyorum; bu hesap için tarayıcı oturumunu kullan
                  </label>
                  {browserAvailability && !browserAvailability.available ? (
                    <p>
                      {browserAvailability.reason.startsWith("Seçili host")
                        ? browserAvailability.reason
                        : "Seçili host'ta Microsoft Edge veya Google Chrome bulunamadı."}
                    </p>
                  ) : null}
                  <div className="social-actions">
                    <Button
                      type="button"
                      variant="primary"

                      disabled={
                        !browserRisk ||
                        !browserAvailability?.available ||
                        browser?.status === "waiting"
                      }
                      onClick={() =>
                        void run(async () => {
                          await queryClient.cancelQueries({ queryKey: browserKey });
                          const status = await client.browserBegin(account.id);
                          await queryClient.cancelQueries({ queryKey: browserKey });
                          setBrowser(status);
                        })
                      }
                    >
                      {account.connected && account.connection === "browser"
                        ? "Tarayıcıda yeniden giriş yap"
                        : "Tarayıcıda X'e giriş yap"}
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() =>
                        void run(async () => {
                          setBrowserAvailability(await client.browserAvailability());
                          setBrowser(await client.browserStatus(account.id));
                        })
                      }
                    >
                      Tarayıcı bağlantısını kontrol et
                    </Button>
                  </div>
                  {browser && browser.status !== "idle" ? (
                    <p role="status">
                      {browser.error ||
                        (
                          {
                            waiting:
                              "Açılan Chrome penceresinde X'e giriş yapın (Google ile giriş de olur). Giriş bitince pencereyi kendiniz kapatın; bycoda oturumu sonra kontrol eder.",
                            connected: "X hesabı tarayıcı oturumuyla bağlandı.",
                            failed: "Bağlantı başarısız",
                          } as Record<string, string>
                        )[browser.status]}
                    </p>
                  ) : null}
                </div>
              ) : null}
              {account.platform === "x" &&
              account.connected &&
              account.connection === "browser" ? null : (
                <Collapsible
                  collapsed={account.platform === "x"}
                  summary="Resmi X API ile bağla (ücretli geliştirici uygulaması gerekir)"
                >
                  <div className="social-connection" role="status">
                    <strong>
                      {availabilityError
                        ? "Bağlantı kontrolü gerekli"
                        : accountConnectionStatus(
                            account,
                            availability[account.platform],
                            oauth?.status,
                          )}
                    </strong>
                    <p>
                      {availabilityError ||
                        (availability[account.platform] === undefined
                          ? "Platform bağlantı ayarları kontrol ediliyor…"
                          : !availability[account.platform].configured
                            ? `${names[account.platform]} bağlantısı hazır değil. Platform uygulamasını ve geri dönüş adresini seçili host üzerinde yapılandırın.`
                            : !account.connected && oauth?.status === "waiting"
                              ? "Açılan platform sayfasında hesabınıza giriş yapıp izin verin. Sonuç burada otomatik kontrol edilir. Sayfa açılmadıysa Tarayıcıda bağla ile yeniden deneyin."
                              : !account.connected && oauth?.status === "selection"
                                ? "Platform hesabınızı doğruladı. Aşağıdaki listeden bağlamak istediğiniz hesabı seçin."
                                : account.connected &&
                                    account.expiresAt &&
                                    account.expiresAt < Date.now()
                                  ? "Bağlantı süresi doldu. Tarayıcıda yeniden bağla ile hesabınıza tekrar izin verin."
                                  : account.connected
                                    ? "Hesap bağlı. İşlemleri ve proje izinlerini aşağıdan yönetin."
                                    : "İzinleri seçip Tarayıcıda bağla düğmesine basın. Açılan platform sayfasında hesabınıza giriş yapıp izin verin; sonuç burada otomatik kontrol edilir.")}
                    </p>
                    {availability[account.platform]?.configured === false ? (
                      <details>
                        <summary>Kurulum için gerekenler</summary>
                        <p>
                          Bu ayarlar sosyal hesap şifreniz değildir. Platform geliştirici
                          uygulamasındaki bilgiler seçili host hizmetine eklenir; buraya gizli
                          anahtar girmeyin.
                        </p>
                        <ul>
                          <li>Uygulama Client ID</li>
                          <li>
                            {account.platform === "x"
                              ? "Gizli anahtar kullanan uygulamalarda Client Secret (public PKCE için isteğe bağlı)"
                              : "Uygulama Client Secret"}
                          </li>
                          <li>Platformda kayıtlı ve host'a ulaşan geri dönüş adresi</li>
                        </ul>
                        <p>
                          Host hizmetinin ortam ayarlarında aşağıdaki adlar kullanılır. Ayarlar
                          uygulama içinde henüz düzenlenemiyor; host kurulumu üzerinden eklenmeli.
                        </p>
                        <code>BYCODA_SOCIAL_{account.platform.toUpperCase()}_CLIENT_ID</code>
                        <br />
                        <code>
                          BYCODA_SOCIAL_{account.platform.toUpperCase()}
                          _CLIENT_SECRET
                        </code>
                        <br />
                        <code>
                          BYCODA_SOCIAL_{account.platform.toUpperCase()}
                          _REDIRECT_URI
                        </code>
                        <p>
                          Geri dönüş adresinin host üzerindeki yolu:{" "}
                          <code>/social/oauth/{account.platform}/callback</code>. Aynı adres
                          platform uygulamasında da kayıtlı olmalı.
                        </p>
                        <p>Host ayarları güncellendikten sonra Yenile düğmesine basın.</p>
                      </details>
                    ) : null}
                  </div>
                  <fieldset className="social-checks">
                    <legend>OAuth ile istenecek yetenekler</legend>
                    {(snapshot.capabilities[account.id] ?? [])
                      .filter((capability) => capability.status !== "unsupported")
                      .map((capability) => (
                        <label key={capability.operation}>
                          <Checkbox
                            checked={oauthOperations.includes(capability.operation)}
                            onChange={(event) =>
                              setOAuthOperations((current) =>
                                event.target.checked
                                  ? [...current, capability.operation]
                                  : current.filter((item) => item !== capability.operation),
                              )
                            }
                          />
                          {operations[capability.operation]}
                        </label>
                      ))}
                  </fieldset>
                  <p>
                    Yalnız seçilen API ürünlerinin izinleri istenir. Platform onayı ve webhook
                    aboneliği ayrıca gerekir.
                  </p>
                  {account.accountType === "organization" ? (
                    <label>
                      LinkedIn organizasyon ID
                      <TextField
                        hideLabel
                        label=""
                        inputMode="numeric"
                        value={resourceId}
                        onChange={(event) => setResourceId(event.target.value)}
                      />
                    </label>
                  ) : null}
                  <div className="social-actions">
                    <Button
                      type="button"
                      variant="primary"

                      disabled={
                        !oauthOperations.length ||
                        !!availabilityError ||
                        !availability[account.platform]?.configured ||
                        (account.accountType === "organization" && !/^\d+$/.test(resourceId))
                      }
                      onClick={() =>
                        void run(async () => {
                          await queryClient.cancelQueries({ queryKey: oauthKey });
                          const begin = await client.oauthBegin(
                            account.id,
                            account.accountType === "organization" ? resourceId : undefined,
                            oauthOperations,
                          );
                          // A waiting poll may have started while begin was in flight.
                          await queryClient.cancelQueries({ queryKey: oauthKey });
                          setOAuth({ status: "waiting", candidates: [] });
                          await openUrl(begin.url);
                        })
                      }
                    >
                      {account.connected ? "Tarayıcıda yeniden bağla" : "Tarayıcıda bağla"}
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() =>
                        void run(async () => setOAuth(await client.oauthStatus(account.id)))
                      }
                    >
                      Bağlantıyı kontrol et
                    </Button>
                  </div>
                  {oauth && availability[account.platform]?.configured ? (
                    <div className="social-connection" role="status">
                      <p>
                        {oauth.error ||
                          (
                            {
                              idle: "Bağlantı başlatılmadı. Platform kurulumu tamamlandıysa Tarayıcıda bağla ile başlayın.",
                              waiting:
                                "Tarayıcıda hesap izni bekleniyor. Açılan platform sayfasında izin verin. Sayfa açılmadıysa Tarayıcıda bağla ile yeniden deneyin.",
                              selection: "Doğrulanan hesabı seçin",
                              connected: "Hesap bağlandı",
                              failed: "Bağlantı başarısız",
                            } as Record<string, string>
                          )[oauth.status]}
                      </p>
                      {(oauth.candidates ?? []).map((candidate) => (
                        <Button
                          type="button"
                          variant="secondary"
                          key={candidate.id}
                          onClick={() =>
                            void run(async () => {
                              await client.oauthSelect(account.id, candidate.id);
                              await queryClient.invalidateQueries({ queryKey: oauthKey });
                            })
                          }
                        >
                          {candidate.name} · Bağla
                        </Button>
                      ))}
                    </div>
                  ) : null}
                </Collapsible>
              )}
              <div className="social-actions">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() =>
                    void run(() =>
                      client.request("accounts.pause", {
                        accountId: account.id,
                        paused: !account.paused,
                      }),
                    )
                  }
                >
                  {account.paused ? "Hesabı devam ettir" : "Hesabı durdur"}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={!account.connected}
                  onClick={() => setDisconnecting(true)}
                >
                  Bağlantıyı kaldır
                </Button>
              </div>
              {disconnecting ? (
                <div className="social-confirm" role="group" aria-label="Bağlantıyı kaldırma onayı">
                  <p>
                    {account.name} hesabının bağlantısı kaldırılacak ve bu hesaptan gönderim
                    duracak.
                  </p>
                  <div className="social-actions">
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() =>
                        void (async () => {
                          if (
                            await run(() =>
                              client.request("accounts.disconnect", {
                                accountId: account.id,
                              }),
                            )
                          )
                            setDisconnecting(false);
                        })()
                      }
                    >
                      Bağlantıyı kaldırmayı onayla
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => setDisconnecting(false)}
                    >
                      Vazgeç
                    </Button>
                  </div>
                </div>
              ) : null}
              <details className="social-form">
                <summary>Kullanılabilir işlemler ve erişim ayrıntıları</summary>
                <p className="social-muted">
                  Yürütücü:{" "}
                  {account.executorId === snapshot.executorId ? "Seçili host" : account.executorId}.
                  Aynı hesabı başka hostta yeniden bağlamak yerine bu hosta bağlanın.
                </p>
                <table>
                  <thead>
                    <tr>
                      <th>İşlem</th>
                      <th>Durum / gerekçe</th>
                    </tr>
                  </thead>
                  <tbody>
                    {snapshot.capabilities[account.id]?.map((cap) => (
                      <tr key={cap.operation}>
                        <td>{operations[cap.operation]}</td>
                        <td>
                          <StatusBadge status={cap.status} />
                          <p>{cap.reason}</p>
                          <a href={cap.source} target="_blank" rel="noreferrer">
                            Resmi belge
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
              <details className="social-form">
                <summary>Proje izinlerini yönet</summary>
                <form
                  className="social-form"
                  onSubmit={(event) => {
                    field(event);
                    void run(() =>
                      client.request("accounts.grants", {
                        accountId: account.id,
                        projectId: grantProject,
                        permissions: grantPermissions,
                      }),
                    );
                  }}
                >
                  <h3>Proje izinleri</h3>
                  <label>
                    Proje
                    <SearchableSelect
                      value={grantProject}
                      label={"Proje"}
                      options={projects.map((project) => ({
                        value: project.id,
                        label: project.name,
                      }))}
                      onChange={(nextValue) => {
                        setGrantProject(nextValue);
                        setGrantPermissions(account.grants[nextValue] ?? []);
                      }}
                      searchLocale="tr"
                    />
                  </label>
                  <fieldset className="social-checks">
                    <legend>Okuma ve gönderim ayrı izinlerdir</legend>
                    {[
                      ["read", "Oku"],
                      ["draft", "Taslak hazırla"],
                      ["publish", "Yayınla"],
                      ["reply", "Yanıtla"],
                      ["message", "Yeni mesaj"],
                      ["comment", "Yorum yap"],
                    ].map(([id, label]) => (
                      <label key={id}>
                        <Checkbox
                          checked={grantPermissions.includes(id)}
                          onChange={(event) =>
                            setGrantPermissions(
                              event.target.checked
                                ? [...grantPermissions, id]
                                : grantPermissions.filter((item) => item !== id),
                            )
                          }
                        />
                        {label}
                      </label>
                    ))}
                  </fieldset>
                  <Button type="submit" variant="secondary" disabled={!grantProject}>
                    İzinleri kaydet
                  </Button>
                  <p className="social-muted">
                    Mevcut izinler:{" "}
                    {Object.entries(account.grants)
                      .map(
                        ([id, allowed]) =>
                          `${projects.find((item) => item.id === id)?.name ?? id}: ${allowed.join(", ") || "yok"}`,
                      )
                      .join("; ")}
                  </p>
                </form>
              </details>
            </>
          ) : (
            <Empty title="Hesabınızı yönetin" icon={Link}>
              Bağlantı durumunu, platform yeteneklerini ve proje erişimini görmek için bir hesap
              seçin.
            </Empty>
          )}
        </section>
      </div>
    </div>
  );
}
