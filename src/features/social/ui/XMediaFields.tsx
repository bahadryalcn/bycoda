import { useContext as useSocialContext } from "react";
import { SocialBusyContext as SocialLockContext } from "./socialContext";
import { useEffect, useRef, useState } from "react";
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
  label,
  help,
  videoOnly = false,
  imagesOnly = false,
  maxVideoMiB = 64,
  maxCount,
  showPreview = false,
  onVideoDurationChange,
  allowAltText = true,
  allowDocuments = false,
  disabled = false,
  onVideoMetadataChange,
}: {
  value: SocialMedia[];
  client: SocialClient;
  onChange: (media: SocialMedia[]) => void;
  onBusyChange?: (busy: boolean) => void;
  message?: boolean;
  /** Optional translated copy for browser platforms; omitted values preserve the X editor. */
  label?: string;
  help?: string;
  videoOnly?: boolean;
  imagesOnly?: boolean;
  maxVideoMiB?: number;
  maxCount?: number;
  showPreview?: boolean;
  onVideoDurationChange?: (seconds: number) => void;
  allowAltText?: boolean;
  allowDocuments?: boolean;
  disabled?: boolean;
  onVideoMetadataChange?: (metadata?: {
    durationSeconds: number;
    width: number;
    height: number;
  }) => void;
}) {
  const socialLocked = useSocialContext(SocialLockContext) || disabled;
  useLocale();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number>();
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<{
    url: string;
    kind: "image" | "video";
    uploadId: string;
  }>();
  const mounted = useRef(true);
  const uploading = useRef(false);
  const callbacks = useRef({
    onChange,
    onBusyChange,
    onVideoDurationChange,
    onVideoMetadataChange,
    client,
  });
  callbacks.current = {
    onChange,
    onBusyChange,
    onVideoDurationChange,
    onVideoMetadataChange,
    client,
  };
  const count = Math.max(1, Math.min(4, maxCount ?? (message ? 1 : 4)));
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (uploading.current) callbacks.current.onBusyChange?.(false);
    };
  }, []);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview.url);
    },
    [preview],
  );
  useEffect(() => {
    setPreview(undefined);
  }, [client]);
  useEffect(() => {
    if (preview && !value.some((item) => item.uploadId === preview.uploadId)) setPreview(undefined);
  }, [preview, value]);
  return (
    <fieldset>
      <legend>{label ?? t("X attachments")}</legend>
      <TextField
        disabled={busy || socialLocked}
        label={
          imagesOnly
            ? t("Images")
            : videoOnly
              ? t("Video file")
              : allowDocuments
                ? t("Image, video or PDF file")
                : t("Image or video file")
        }
        type="file"
        multiple={!videoOnly && count > 1}
        accept={
          imagesOnly
            ? "image/jpeg,image/png"
            : videoOnly
              ? "video/mp4"
              : `image/jpeg,image/png,video/mp4${allowDocuments ? ",application/pdf" : ""}`
        }
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          if (!files.length || uploading.current || socialLocked) return;
          const video = files.some((file) => file.type === "video/mp4");
          const pdf = files.some((file) => file.type === "application/pdf");
          if (
            files.some((file) => file.type === "video/mp4" && file.size > maxVideoMiB * 1024 * 1024)
          ) {
            setError(t("Videos can be at most {p0} MiB.", { p0: maxVideoMiB }));
            return;
          }
          if (
            files.length > count ||
            ((video || pdf) && files.length !== 1) ||
            files.some(
              (file) =>
                !(
                  imagesOnly
                    ? ["image/jpeg", "image/png"]
                    : videoOnly
                      ? ["video/mp4"]
                      : [
                          "image/jpeg",
                          "image/png",
                          "video/mp4",
                          ...(allowDocuments ? ["application/pdf"] : []),
                        ]
                ).includes(file.type),
            )
          ) {
            setError(
              imagesOnly
                ? t("Select up to {p0} JPEG/PNG images.", { p0: count })
                : allowDocuments
                  ? t("Select up to four JPEG/PNG images, one MP4 or one PDF.")
                  : videoOnly
                    ? t("Select a single MP4 video.")
                    : count === 4
                      ? t("Select up to four JPEG/PNG images or a single MP4.")
                      : t("Select up to {p0} JPEG/PNG images or a single MP4.", { p0: count }),
            );
            return;
          }
          uploading.current = true;
          setBusy(true);
          callbacks.current.onBusyChange?.(true);
          setError("");
          setProgress(video ? 0 : undefined);
          setPreview(undefined);
          callbacks.current.onVideoDurationChange?.(0);
          callbacks.current.onVideoMetadataChange?.();
          void (async () => {
            try {
              const next: SocialMedia[] = [];
              for (const file of files) {
                const kind =
                  file.type === "application/pdf"
                    ? "document"
                    : file.type === "video/mp4"
                      ? "video"
                      : "image";
                const uploaded =
                  kind === "document"
                    ? await client.uploadDocument(file)
                    : kind === "video"
                      ? await client.uploadVideo(file, setProgress)
                      : await client.upload(file);
                next.push({
                  kind,
                  uploadId: uploaded.uploadId,
                  ...(kind === "document"
                    ? { title: file.name.replace(/\.pdf$/i, "").slice(0, 58) }
                    : {}),
                });
              }
              if (!mounted.current || callbacks.current.client !== client) return;
              callbacks.current.onChange(next);
              if (showPreview && next.length === 1 && next[0].kind !== "document") {
                setPreview({
                  url: URL.createObjectURL(files[0]),
                  kind: next[0].kind,
                  uploadId: next[0].uploadId!,
                });
              }
            } catch {
              if (mounted.current)
                setError(
                  imagesOnly
                    ? t("Upload failed. JPEG/PNG must be at most 5 MiB.")
                    : videoOnly
                      ? t("Upload failed. MP4 must be at most {p0} MiB.", { p0: maxVideoMiB })
                      : allowDocuments
                        ? t(
                            "Upload failed. JPEG/PNG and PDF must be at most 5 MiB; MP4 at most {p0} MiB.",
                            { p0: maxVideoMiB },
                          )
                        : t(
                            "Upload failed. JPEG/PNG must be at most 5 MiB and MP4 at most {p0} MiB.",
                            { p0: maxVideoMiB },
                          ),
                );
            } finally {
              uploading.current = false;
              if (mounted.current) setBusy(false);
              callbacks.current.onBusyChange?.(false);
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
      {preview && showPreview ? (
        preview.kind === "video" ? (
          <video
            className="max-w-full"
            controls
            preload="metadata"
            src={preview.url}
            onLoadedMetadata={(event) => {
              const duration = event.currentTarget.duration;
              onVideoDurationChange?.(Number.isFinite(duration) && duration > 0 ? duration : 0);
              onVideoMetadataChange?.({
                durationSeconds: Number.isFinite(duration) && duration > 0 ? duration : 0,
                width: event.currentTarget.videoWidth,
                height: event.currentTarget.videoHeight,
              });
            }}
            onError={() => {
              onVideoDurationChange?.(0);
              onVideoMetadataChange?.();
            }}
          />
        ) : (
          <img className="max-w-full" src={preview.url} alt={t("Selected image preview")} />
        )
      ) : null}
      {value.length ? (
        <>
          <p role="status">
            {value.some((item) => item.kind === "document")
              ? t("1 PDF uploaded to the host.")
              : value.some((item) => item.kind === "video")
                ? t("1 video uploaded to the host.")
                : value.length === 1
                  ? t("1 image uploaded to the host.")
                  : t("{p0} images uploaded to the host.", { p0: value.length })}
          </p>
          <div className="grid gap-2">
            {value.map((item, index) =>
              item.kind === "document" ? (
                <TextField
                  disabled={busy || socialLocked}
                  key={index}
                  label={t("Document title")}
                  value={item.title ?? ""}
                  required
                  maxLength={58}
                  onChange={(event) =>
                    onChange(
                      value.map((media, position) =>
                        position === index ? { ...media, title: event.target.value } : media,
                      ),
                    )
                  }
                />
              ) : item.kind === "image" && allowAltText ? (
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
            onClick={() => {
              setPreview(undefined);
              onVideoDurationChange?.(0);
              onVideoMetadataChange?.();
              onChange([]);
            }}
          >
            {t("Remove attachments")}
          </Button>
        </>
      ) : null}
      <small>
        {help ??
          (imagesOnly
            ? t("JPEG/PNG: 5 MiB. A new selection replaces the current images.")
            : t(
                "JPEG/PNG: 5 MiB · MP4: 64 MiB. A new selection replaces the current attachments. PDFs and other documents can't be attached to a tweet; share a link instead.",
              ))}
      </small>
    </fieldset>
  );
}
