import { Checkbox } from "../../../shared/ui/Checkbox";
import { Button } from "../../../shared/ui/Button";
import { t, useLocale } from "../../../shared/i18n";
import { useState } from "react";
import { Notice, StatusBadge, type Props } from "./socialShared";

export function SocialSendingControls({ snapshot, client, run }: Props) {
  useLocale();
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const execute = async (key: string, action: () => Promise<unknown>, message: string) => {
    if (pending) return;
    setPending(key);
    try {
      await run(action, message);
    } finally {
      setPending(null);
    }
  };
  return (
    <section className="social-sending-controls" aria-label={t("Gönderim kontrolleri")}>
      <header className="social-section-heading">
        <h2>{t("Gönderim kontrolleri")}</h2>
        <StatusBadge
          status={snapshot.stopped ? "paused" : snapshot.sendingEnabled ? "active" : "draft"}
          label={
            snapshot.stopped
              ? t("Durduruldu")
              : snapshot.sendingEnabled
                ? t("Onaylı gönderimler açık")
                : t("Gönderim kapalı")
          }
        />
      </header>
      <Notice
        kind={snapshot.stopped || !snapshot.sendingEnabled ? "warning" : "success"}
        title={snapshot.stopped ? t("Bekleyen işler korunuyor") : t("Gönderim için onay gerekir")}
      >
        {snapshot.stopped
          ? t("Hazır olduğunuzda gönderimleri devam ettirin.")
          : t(
              "Taslaklar gönderilmez. Yalnız onayladığınız içerikler ve etkin kurallar gönderim yapabilir.",
            )}
      </Notice>
      {!snapshot.hostOnline ? (
        <Notice kind="warning" title={t("Gönderim hizmetine bağlanılamıyor")}>
          {t("İşlemleri yönetmek için seçili bilgisayarın bağlantısını kontrol edin.")}
        </Notice>
      ) : null}
      {!snapshot.sendingEnabled ? (
        <div className="social-confirm">
          <label className="social-inline-check">
            <Checkbox
              checked={confirmed}
              disabled={!!pending}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            {t("Onayladığım içerikler ve etkin kurallar gerçek hesaplarımdan gönderilebilir.")}
          </label>
          <Button
            variant="primary"
            type="button"
            loading={pending === "enable"}
            disabled={!confirmed || !snapshot.hostOnline || !!pending}
            onClick={() =>
              void execute(
                "enable",
                () => client.request("execution.enable", { confirm: "ENABLE_EXTERNAL_SENDS" }),
                t("Onaylı gönderimler açıldı. Taslaklar ayrıca onay gerektirir."),
              )
            }
          >
            {t("Onaylı gönderimleri aç")}
          </Button>
        </div>
      ) : null}
      <div className="social-setting-row">
        <div>
          <h3>{t("Tüm gönderimler")}</h3>
          <p className="social-muted">
            {t("Planları ve içerikleri silmeden gönderimi duraklatın.")}
          </p>
        </div>
        <Button
          variant="secondary"
          type="button"
          tone={snapshot.stopped ? "neutral" : "danger"}
          loading={pending === "stop"}
          disabled={!snapshot.hostOnline || !!pending}
          onClick={() =>
            void execute(
              "stop",
              () => client.request("execution.stop", { stopped: !snapshot.stopped }),
              snapshot.stopped ? t("Gönderimler devam ediyor.") : t("Tüm gönderimler durduruldu."),
            )
          }
        >
          {snapshot.stopped ? t("Gönderimleri devam ettir") : t("Tüm gönderimleri durdur")}
        </Button>
      </div>
      <div className="social-setting-row">
        <div>
          <h3>{t("Gelen kutusunu otomatik yenile")}</h3>
          <p className="social-muted">
            {t("Yalnız mesaj ve yorum okuma erişimi olan hesaplar yenilenir.")}
          </p>
          <StatusBadge
            status={snapshot.pollingEnabled ? "active" : "paused"}
            label={
              snapshot.pollingEnabled ? t("Otomatik yenileme açık") : t("Otomatik yenileme kapalı")
            }
          />
        </div>
        <Button
          variant="secondary"
          type="button"
          loading={pending === "polling"}
          disabled={!!pending}
          onClick={() =>
            void execute(
              "polling",
              () => client.request("inbox.polling", { enabled: !snapshot.pollingEnabled }),
              snapshot.pollingEnabled
                ? t("Gelen kutusu otomatik yenilemesi kapatıldı.")
                : t("İzinli hesaplarda otomatik yenileme açıldı."),
            )
          }
        >
          {snapshot.pollingEnabled ? t("Otomatik yenilemeyi kapat") : t("Otomatik yenilemeyi aç")}
        </Button>
      </div>
    </section>
  );
}
