import { useState } from "react";
import { Button } from "../../../shared/ui/Button";
import { TextField } from "../../../shared/ui/TextField";
import { t } from "../../../shared/i18n";
import type { SocialMedia } from "../model/social";
import type { SocialClient } from "../model/socialClient";

/** Uses the existing owner upload transport; never reads an arbitrary local path. */
export function XMediaFields({
  value,
  client,
  onChange,
  onBusyChange,
  message = false,
}: {
  value: SocialMedia[];
  client: SocialClient;
  onChange: (media: SocialMedia[]) => void;
  onBusyChange?: (busy: boolean) => void;
  message?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  return (
    <fieldset disabled={busy}>
      <legend>X ekleri</legend>
      <TextField
        label="Resim veya video dosyası"
        type="file"
        multiple
        accept="image/jpeg,image/png,video/mp4"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          if (!files.length || busy) return;
          const video = files.some((file) => file.type === "video/mp4");
          if (
            files.length > (message ? 1 : 4) ||
            (video && files.length !== 1) ||
            files.some((file) => !["image/jpeg", "image/png", "video/mp4"].includes(file.type))
          ) {
            setError("En fazla dört JPEG/PNG veya tek MP4 seçin.");
            return;
          }
          setBusy(true);
          onBusyChange?.(true);
          setError("");
          setProgress(0);
          void (async () => {
            try {
              const next: SocialMedia[] = [];
              for (const file of files) {
                const kind = file.type === "video/mp4" ? "video" : "image";
                const uploaded =
                  kind === "video"
                    ? await client.uploadVideo(file, setProgress)
                    : await client.upload(file);
                next.push({ kind, uploadId: uploaded.uploadId });
              }
              onChange(next);
            } catch {
              setError(
                "Yükleme tamamlanamadı. JPEG/PNG en fazla 5 MiB, MP4 en fazla 64 MiB olmalı.",
              );
            } finally {
              setBusy(false);
              onBusyChange?.(false);
            }
          })();
        }}
      />
      {busy ? <p role="status">Host'a yükleniyor · %{progress}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {value.length ? (
        <>
          <p role="status">
            {value.some((item) => item.kind === "video") ? "1 video" : `${value.length} görsel`}{" "}
            host'a yüklendi.
          </p>
          <div className="grid gap-2">
            {value.map((item, index) =>
              item.kind === "image" ? (
                <TextField
                  key={index}
                  label={`${t("Image alt text")} ${index + 1}`}
                  value={item.alt ?? ""}
                  maxLength={1000}
                  onChange={(event) =>
                    onChange(
                      value.map((media, position) =>
                        position === index ? { ...media, alt: event.target.value } : media,
                      ),
                    )
                  }
                />
              ) : null,
            )}
          </div>
          <Button type="button" onClick={() => onChange([])}>
            Ekleri kaldır
          </Button>
        </>
      ) : null}
      <small>
        JPEG/PNG: 5 MiB · MP4: 64 MiB. Yeni seçim mevcut eklerin yerini alır. PDF ve diğer belgeler
        tweet eki olarak yüklenemez; bağlantı paylaşın.
      </small>
    </fieldset>
  );
}
