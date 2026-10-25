import { useContext as useSocialContext } from "react";
import { SocialBusyContext as SocialLockContext } from "./socialContext";
import { useState } from "react";
import { Button } from "../../../shared/ui/Button";
import { Progress } from "../../../shared/ui/Progress";
import { TextField } from "../../../shared/ui/TextField";
import { t, useLocale } from "../../../shared/i18n";
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
  const socialLocked = useSocialContext(SocialLockContext);
  useLocale();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number>();
  const [error, setError] = useState("");
  return (
    <fieldset>
      <legend>{t("X attachments")}</legend>
      <TextField
        disabled={busy || socialLocked}
        label={t("Image or video file")}
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
            setError(t("Select up to four JPEG/PNG images or a single MP4."));
            return;
          }
          setBusy(true);
          onBusyChange?.(true);
          setError("");
          setProgress(video ? 0 : undefined);
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
              setError(t("Upload failed. JPEG/PNG must be at most 5 MiB and MP4 at most 64 MiB."));
            } finally {
              setBusy(false);
              onBusyChange?.(false);
            }
          })();
        }}
      />
      {busy ? (
        <Progress
          value={progress}
          max={100}
          label={
            progress === undefined
              ? t("Image or video file")
              : t("Uploading to host · {p0}%", { p0: progress })
          }
        />
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      {value.length ? (
        <>
          <p role="status">
            {value.some((item) => item.kind === "video")
              ? t("1 video uploaded to the host.")
              : value.length === 1
                ? t("1 image uploaded to the host.")
                : t("{p0} images uploaded to the host.", { p0: value.length })}
          </p>
          <div className="grid gap-2">
            {value.map((item, index) =>
              item.kind === "image" ? (
                <TextField
                  disabled={busy || socialLocked}
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
          <Button
            disabled={busy || socialLocked}
            type="button"
            variant="secondary"
            tone="danger"
            onClick={() => onChange([])}
          >
            {t("Remove attachments")}
          </Button>
        </>
      ) : null}
      <small>
        {t(
          "JPEG/PNG: 5 MiB · MP4: 64 MiB. A new selection replaces the current attachments. PDFs and other documents can't be attached to a tweet; share a link instead.",
        )}
      </small>
    </fieldset>
  );
}
