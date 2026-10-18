import { useContext, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "../../../shared/ui/Button";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { Select } from "../../../shared/ui/Select";
import { TextField } from "../../../shared/ui/TextField";
import { useQueryVisible } from "../../../shared/hooks/useQueryVisible";
import type { SocialAccount } from "../model/social";
import type { SocialClient } from "../model/socialClient";
import { socialQueryScope } from "../model/socialQuery";
import {
  SOCIAL_BROWSER_INTENTS,
  SOCIAL_BROWSER_LABELS,
  SOCIAL_BROWSER_SITES,
  type SocialBrowserIntent,
  type SocialBrowserWorkflow,
} from "../model/socialBrowser";
import { SocialPanelActiveContext } from "./socialContext";
import { XProfileManager } from "./XProfileManager";

const statuses: Record<SocialBrowserWorkflow["status"], string> = {
  queued: "Tarayıcı sırası bekleniyor",
  awaiting_owner: "Tarayıcıda kullanıcı işlemi bekleniyor",
  window_closed: "Pencere kapandı; sonuç doğrulanmadı",
  cancelled: "İptal edildi",
  expired: "Süre doldu; yeniden açın",
  interrupted: "Host yeniden başladı; yeniden açın",
  failed: "Açılamadı; host bağlantısını kontrol edin",
};

/** Owner-assisted work is shown separately from verified send and inbox adapters. */
export function SocialBrowserWorkspace({
  account,
  client,
}: {
  account: SocialAccount;
  client: SocialClient;
}) {
  const active = useContext(SocialPanelActiveContext);
  const visible = useQueryVisible();
  const [open, setOpen] = useState(false);
  const [intent, setIntent] = useState<SocialBrowserIntent>("login");
  const [target, setTarget] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const query = useQuery({
    queryKey: [...socialQueryScope(client), "browser-workflows", account.id],
    queryFn: () => client.browserWorkflowStatus(account.id),
    enabled: open && active && visible,
    retry: false,
    staleTime: 5_000,
    refetchInterval: (q) =>
      active &&
      visible &&
      q.state.data?.workflows.some((item) => ["queued", "awaiting_owner"].includes(item.status))
        ? 3_000
        : false,
  });
  const current = query.data?.workflows.find((item) =>
    ["queued", "awaiting_owner"].includes(item.status),
  );
  const monitor = useQuery({
    queryKey: [...socialQueryScope(client), "monitoring", account.id],
    queryFn: () => client.monitoringStatus(account.id),
    enabled: open && active && visible && account.connected,
    staleTime: 30_000,
    retry: false,
    refetchInterval: open && active && visible && account.connected ? 30_000 : false,
  });
  const options = SOCIAL_BROWSER_INTENTS.filter((value) =>
    value === "comments"
      ? ["x", "instagram", "facebook", "linkedin", "youtube", "tiktok"].includes(account.platform)
      : !!SOCIAL_BROWSER_SITES[account.platform].routes[value],
  ).map((value) => ({ value, label: SOCIAL_BROWSER_LABELS[value] }));
  const perform = async (action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
      await Promise.all([
        query.refetch({ throwOnError: true }),
        account.connected ? monitor.refetch({ throwOnError: true }) : Promise.resolve(),
      ]);
    } catch {
      setError(
        "İşlem tamamlanamadı. Seçili host'u ve açık tarayıcı işlemini kontrol edip yeniden deneyin.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <details
      className="social-connection"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>Tarayıcı çalışma alanı</summary>
      {account.platform === "x" && account.connection === "browser" && account.connected ? (
        <XProfileManager accountId={account.id} client={client} />
      ) : null}
      {monitor.data ? (
        <p role="status">
          Otomatik takip:{" "}
          {monitor.data.pollingEnabled === false
            ? "Kapalı"
            : monitor.data.accountActive === false
              ? "Bu hesap için duraklatıldı"
              : {
                  idle: "Henüz kontrol edilmedi",
                  healthy: "Son kontrol başarılı",
                  partial: "Kısmi takip; bazı kanallar okunamadı",
                  blocked: "Takip engellendi; bağlantıyı kontrol edin",
                }[monitor.data.status]}
          {monitor.data.checkedAt
            ? ` · ${new Date(monitor.data.checkedAt).toLocaleString("tr-TR")}`
            : ""}
        </p>
      ) : null}
      {monitor.data?.coverage?.some((channel) => channel.reason === "chat_setup_required") ? (
        <p role="status">X Sohbet için tarayıcıda erişim kodu kurulumu gerekiyor.</p>
      ) : monitor.data?.coverage?.some(
          (channel) => channel.reason === "encrypted_chat_unsupported",
        ) ? (
        <p role="status">X’in şifreli Sohbet kanalı bu bağlantıyla okunamıyor.</p>
      ) : null}
      {monitor.isError ? <p role="alert">Otomatik takip durumu okunamadı.</p> : null}
      {monitor.data?.coverage?.length ? (
        <p role="status">
          {monitor.data.coverage
            .map(
              (item) =>
                `${{ mentions: "Bahsetmeler", messages: "Mesajlar", comments: "Tweet yorumları" }[item.channel]}: ${item.status === "read" ? "okundu" : "okunamadı"}`,
            )
            .join(" · ")}
        </p>
      ) : null}
      <p className="social-muted">
        Bu bölüm kayıt ve bağlantı kurtarma içindir. Bağlı hesapların otomatik takibi host'ta,
        gönderimleri etkin yayın programları ve yanıt kurallarıyla yürür.
      </p>
      <Select
        label="Tarayıcı işlemi"
        value={intent}
        options={options}
        onValueChange={(value) => setIntent(value as SocialBrowserIntent)}
        disabled={busy || !!current}
      />
      {intent === "comments" ? (
        <TextField
          label="Gönderi bağlantısı"
          value={target}
          onChange={(event) => setTarget(event.target.value)}
          disabled={busy || !!current}
        />
      ) : null}
      <label className="social-inline-check">
        <Checkbox
          checked={acknowledged}
          onChange={(event) => setAcknowledged(event.target.checked)}
          disabled={busy}
        />
        Bu hesap için ayrı tarayıcı profilini aç
      </label>
      {intent === "signup" ? (
        <p>
          Kayıt koşulları, parola, doğrulama kodu ve CAPTCHA adımlarını açılan tarayıcıda
          tamamlayın.
        </p>
      ) : null}
      {account.platform === "whatsapp" || account.platform === "telegram" ? (
        <p className="social-muted">
          Yeni hesap kaydı mobil uygulamada yapılır; burada web oturumu açılır.
        </p>
      ) : null}
      {!query.data?.available && query.data ? (
        <p role="status">Seçili host'ta Chrome veya Edge bulunamadı.</p>
      ) : null}
      {query.isError ? (
        <p role="alert">
          Tarayıcı durumu okunamadı. Host sürümünü ve bağlantısını kontrol edip yenileyin.
        </p>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      <div className="social-actions">
        <Button
          disabled={
            busy ||
            !!current ||
            !acknowledged ||
            !query.data?.available ||
            (intent === "comments" && !target.trim())
          }
          onClick={() =>
            void perform(() =>
              client.browserWorkflowBegin(
                account.id,
                intent,
                intent === "comments" ? target : undefined,
              ),
            )
          }
        >
          Tarayıcıda aç
        </Button>
        <Button
          disabled={busy || query.isFetching}
          onClick={() => void perform(async () => undefined)}
        >
          Durumu yenile
        </Button>
        {current ? (
          <Button
            disabled={busy}
            onClick={() => void perform(() => client.browserWorkflowCancel(account.id))}
          >
            İşlemi iptal et
          </Button>
        ) : null}
      </div>
      <div role="status" aria-live="polite">
        {query.data?.workflows[0] ? (
          <p>
            {SOCIAL_BROWSER_LABELS[query.data.workflows[0].intent]}:{" "}
            {statuses[query.data.workflows[0].status]}
          </p>
        ) : null}
      </div>
      {query.data && query.data.workflows.length > 1 ? (
        <details>
          <summary>Önceki tarayıcı işlemleri</summary>
          <ul>
            {query.data.workflows.slice(1).map((item) => (
              <li key={item.id}>
                {SOCIAL_BROWSER_LABELS[item.intent]}: {statuses[item.status]}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </details>
  );
}
