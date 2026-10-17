import { Checkbox } from "../../../shared/ui/Checkbox";
import { Button } from "../../../shared/ui/Button";
import { useState } from "react";
import { Notice, StatusBadge, type Props } from "./socialShared";

export function SocialSendingControls({ snapshot, client, run }: Props) {
  const [confirmed, setConfirmed] = useState(false);
  return (
    <section className="social-sending-controls" aria-label="Gönderim kontrolleri">
      <header className="social-section-heading">
        <h2>Gönderim kontrolleri</h2>
        <StatusBadge
          status={snapshot.stopped ? "paused" : snapshot.sendingEnabled ? "active" : "draft"}
          label={
            snapshot.stopped
              ? "Tüm gönderimler durduruldu"
              : snapshot.sendingEnabled
                ? "Onaylı gönderimler açık"
                : "Gönderim kapalı"
          }
        />
      </header>
      <Notice
        kind={snapshot.stopped || !snapshot.sendingEnabled ? "warning" : "success"}
        title={
          snapshot.stopped
            ? "Bekleyen işler korunuyor"
            : snapshot.sendingEnabled
              ? "Yalnız onaylı işler gönderilebilir"
              : "Taslak hazırlayabilirsiniz"
        }
      >
        {snapshot.stopped
          ? "Planları ve içerikleri inceleyip hazır olduğunuzda gönderimleri devam ettirin."
          : "Bir taslak oluşturmak gönderim yapmaz. Gönderilecek içerik için onay veya etkin bir kural gerekir."}
      </Notice>
      {!snapshot.sendingEnabled ? (
        <div className="social-confirm">
          <label className="social-inline-check">
            <Checkbox
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            Onayladığım işler ve etkin kurallar gerçek hesaplarda gönderim yapabilir.
          </label>
          <Button
            variant="primary"
            type="button"

            disabled={!confirmed || !snapshot.hostOnline}
            onClick={() =>
              void run(
                () => client.request("execution.enable", { confirm: "ENABLE_EXTERNAL_SENDS" }),
                "Onaylı gönderimler açıldı. Taslaklar ayrıca onay gerektirir.",
              )
            }
          >
            Onaylı gönderimleri aç
          </Button>
        </div>
      ) : null}
      <div className="social-actions">
        <Button
          variant="secondary"
          type="button"
          disabled={!snapshot.hostOnline}
          onClick={() =>
            void run(
              () => client.request("execution.stop", { stopped: !snapshot.stopped }),
              snapshot.stopped ? "Gönderimler devam ediyor." : "Tüm gönderimler durduruldu.",
            )
          }
        >
          {snapshot.stopped ? "Tüm gönderimleri devam ettir" : "Tüm gönderimleri durdur"}
        </Button>
      </div>
      <details className="social-settings">
        <summary>Gelen kutusunu otomatik yenile</summary>
        <p className="social-muted">
          Yalnız platformun okuma erişimi bulunan hesaplar yenilenir. Tarayıcı bağlantısının
          desteklemediği mesaj ve yorumlar alınamaz.
        </p>
        <StatusBadge
          status={snapshot.pollingEnabled ? "active" : "paused"}
          label={snapshot.pollingEnabled ? "Otomatik yenileme açık" : "Otomatik yenileme kapalı"}
        />
        <div className="social-actions">
          <Button
            variant="secondary"
            type="button"
            onClick={() =>
              void run(
                () => client.request("inbox.polling", { enabled: !snapshot.pollingEnabled }),
                snapshot.pollingEnabled
                  ? "Gelen kutusu otomatik yenilemesi kapatıldı."
                  : "İzinli hesaplarda otomatik yenileme açıldı.",
              )
            }
          >
            {snapshot.pollingEnabled ? "Otomatik yenilemeyi kapat" : "Otomatik yenilemeyi aç"}
          </Button>
        </div>
      </details>
    </section>
  );
}
