import { useState } from "react";
import { t } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";
import { Text } from "../../../../shared/ui/Text";
import { FileField } from "../../../../shared/ui/FileField";
import { FieldGroup } from "../../../../shared/ui/FieldGroup";
import { Select } from "../../../../shared/ui/Select";
import { TextField } from "../../../../shared/ui/TextField";
import { INSTAGRAM_CAROUSEL_MAX } from "../../../../integrations/social/adapters/instagram-publish";
import type { SocialClient } from "../../model/socialClient";
import { uploadForSocialEditor, type SocialMediaEditor } from "../../model/socialMediaEditor";
import type { ContentMedia } from "./contentDraft";
import { probeVideo } from "./mediaProbe";
import { isPublicMediaUrl } from "./contentRules";
import { presentRemoteError } from "../../../connections/public/remoteFailure";

const IMAGE_TYPES = ["image/jpeg", "image/png"];
const VIDEO_TYPE = "video/mp4";
const PDF_TYPE = "application/pdf";

export type ContentMediaFieldProps = {
  client: SocialClient;
  editor: SocialMediaEditor;
  media: ContentMedia[];
  allowTikTokPhotoUrls?: boolean;
  disabled: boolean;
  allowDocument?: boolean;
  /** Why attaching is off (for example the account cannot upload media). */
  disabledReason?: string;
  instagramMedia?: "public-only" | "mixed";
  onChange: (next: ContentMedia[]) => void;
  onBusyChange?: (busy: boolean) => void;
  youtubeAccountId?: string;
};

/** Attach images or one video. Rules per platform are checked in the preview and the publish gate. */
export function ContentMediaField({
  client,
  editor,
  media,
  allowTikTokPhotoUrls,
  disabled,
  allowDocument,
  disabledReason,
  instagramMedia,
  onChange,
  onBusyChange,
  youtubeAccountId,
}: ContentMediaFieldProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [address, setAddress] = useState("");
  const [remoteKind, setRemoteKind] = useState<"image" | "video">("image");
  const [urlError, setUrlError] = useState<string>();
  const atInstagramLimit = !!instagramMedia && media.length >= INSTAGRAM_CAROUSEL_MAX;
  const [photoUrl, setPhotoUrl] = useState("");
  const [photoUrlError, setPhotoUrlError] = useState<string>();
  const addTikTokPhotoUrl = () => {
    const url = URL.parse(photoUrl.trim());
    if (!url || url.protocol !== "https:" || url.username || url.password) {
      setPhotoUrlError(t("Enter a public HTTPS photo URL."));
      return;
    }
    if (media.some((item) => item.media.url === url.href)) {
      setPhotoUrlError(t("This TikTok photo is already attached."));
      return;
    }
    onChange([
      ...media,
      { localId: crypto.randomUUID(), name: url.hostname, media: { kind: "image", url: url.href } },
    ]);
    setPhotoUrl("");
    setPhotoUrlError(undefined);
  };
  const add = async (files: File[]) => {
    setBusy(true);
    onBusyChange?.(true);
    setError(undefined);
    try {
      // Refuse the whole pick before any upload, so a batch with one bad file uploads nothing.
      if (instagramMedia && media.length + files.length > INSTAGRAM_CAROUSEL_MAX)
        throw new Error(t("Instagram carousel supports up to 20 images and videos."));
      const types = [
        ...IMAGE_TYPES,
        VIDEO_TYPE,
        ...(allowDocument ? [PDF_TYPE] : []),
        ...(youtubeAccountId ? ["video/webm"] : []),
      ];
      if (files.some((file) => !types.includes(file.type)))
        throw new Error(
          allowDocument
            ? t("Use JPEG or PNG images, one MP4 video, or one PDF document.")
            : youtubeAccountId
              ? t("Use JPEG or PNG images, or one MP4 or WebM video.")
              : t("Use JPEG or PNG images, or one MP4 video."),
        );
      if (
        (files.some((file) => file.type === PDF_TYPE) ||
          media.some((item) => item.media.kind === "document")) &&
        files.length + media.length !== 1
      )
        throw new Error(t("Attach one PDF document by itself."));
      const added: ContentMedia[] = [];
      for (const file of files) {
        const isDocument = file.type === PDF_TYPE;
        const upload = await uploadForSocialEditor(
          editor,
          client,
          file,
          undefined,
          youtubeAccountId,
        );
        const isVideo = file.type.startsWith("video/");
        const probe = isVideo ? await probeVideo(file).catch(() => undefined) : undefined;
        added.push({
          localId: upload.uploadId,
          name: file.name,
          media: {
            kind: isDocument ? "document" : isVideo ? "video" : "image",
            uploadId: upload.uploadId,
            ...(isDocument ? { title: file.name.replace(/\.pdf$/i, "").slice(0, 58) } : {}),
          },
          probe,
          ...(isVideo && file.size > 64 * 1024 * 1024 ? { youtubeApiOnly: true } : {}),
          mediaId: upload.managed?.mediaId,
        });
      }
      onChange([...media, ...added]);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? presentRemoteError(caught, { explicit: true })
          : t("The file could not be attached."),
      );
    } finally {
      setBusy(false);
      onBusyChange?.(false);
    }
  };
  const addPublicMedia = () => {
    const url = address.trim();
    if (!isPublicMediaUrl(url)) {
      setUrlError(t("Enter a public HTTPS media URL without credentials."));
      return;
    }
    const path = new URL(url).pathname.split("/").filter(Boolean).pop();
    onChange([
      ...media,
      {
        localId: crypto.randomUUID(),
        name: path || (remoteKind === "image" ? t("Image") : t("Video")),
        media: { kind: remoteKind, url },
      },
    ]);
    setAddress("");
    setUrlError(undefined);
  };
  const remove = (item: ContentMedia) => {
    onChange(media.filter((other) => other.localId !== item.localId));
    if (item.mediaId) void editor.releaseCurrent(item.mediaId).catch(() => {});
  };
  return (
    <div className="content-media">
      {instagramMedia !== "public-only" ? (
        <FileField
          label={
            instagramMedia
              ? t("Images and videos")
              : allowDocument
                ? t("Images, video or PDF")
                : t("Images or one video")
          }
          multiple
          accept={
            allowDocument
              ? "image/jpeg,image/png,video/mp4,application/pdf"
              : youtubeAccountId
                ? "image/jpeg,image/png,video/mp4,video/webm"
                : "image/jpeg,image/png,video/mp4"
          }
          disabled={disabled || busy || atInstagramLimit}
          description={disabledReason ?? (busy ? t("Uploading…") : undefined)}
          hint={
            instagramMedia
              ? t("JPEG, PNG or MP4 files.")
              : allowDocument
                ? t("Use JPEG or PNG images, one MP4 video, or one PDF document.")
                : youtubeAccountId
                  ? t("Use JPEG or PNG images, or one MP4 or WebM video.")
                  : t("JPEG or PNG images, or one MP4 video.")
          }
          error={error}
          onFiles={(files) =>
            void add(files).catch(() => setError(t("The file could not be attached.")))
          }
        />
      ) : null}
      {instagramMedia ? (
        <FieldGroup
          legend={t("Instagram media")}
          disabled={disabled || busy || atInstagramLimit}
          description={
            disabledReason ?? t("Instagram carousel supports up to 20 images and videos.")
          }
          descriptionVisible
        >
          <Select
            label={t("Media type")}
            value={remoteKind}
            disabled={disabled || busy || atInstagramLimit}
            options={[
              { value: "image", label: t("Image") },
              { value: "video", label: t("Video") },
            ]}
            onValueChange={(value) => setRemoteKind(value === "video" ? "video" : "image")}
          />
          <TextField
            label={t("Public media URL")}
            type="url"
            maxLength={2048}
            value={address}
            error={urlError}
            onChange={(event) => {
              setAddress(event.target.value);
              setUrlError(undefined);
            }}
          />
          <Button size="sm" disabled={!address.trim()} onClick={addPublicMedia}>
            {t("Attach media URL")}
          </Button>
        </FieldGroup>
      ) : null}
      {allowTikTokPhotoUrls ? (
        <>
          <TextField
            label={t("TikTok photo URL")}
            description={t("Use photo URLs on a TikTok-verified domain or URL prefix.")}
            type="url"
            value={photoUrl}
            disabled={disabled || busy || media.length >= 4}
            error={photoUrlError}
            onChange={(event) => {
              setPhotoUrl(event.target.value);
              setPhotoUrlError(undefined);
            }}
          />
          <Button
            variant="secondary"
            size="sm"
            disabled={disabled || busy || media.length >= 4 || !photoUrl.trim()}
            onClick={addTikTokPhotoUrl}
          >
            {t("Add")}
          </Button>
        </>
      ) : null}
      {media.length ? (
        <ul className="content-media-list">
          {media.map((item) => (
            <Text as="li" size="secondary" tone="inherit" leading="inherit" key={item.localId}>
              <Text as="span" size="inherit" tone="inherit" leading="inherit" truncate>
                {item.name}
              </Text>
              <Button
                variant="ghost"
                size="sm"
                disabled={disabled || busy}
                onClick={() => remove(item)}
              >
                {t("Remove {p0}", { p0: item.name })}
              </Button>
            </Text>
          ))}
        </ul>
      ) : null}
      {media.map((item) =>
        item.media.kind === "document" ? (
          <TextField
            key={item.localId}
            label={t("Document title")}
            required
            maxLength={58}
            disabled={disabled || busy}
            value={item.media.title ?? ""}
            onChange={(event) =>
              onChange(
                media.map((other) =>
                  other.localId === item.localId
                    ? { ...other, media: { ...other.media, title: event.target.value } }
                    : other,
                ),
              )
            }
          />
        ) : null,
      )}
    </div>
  );
}
