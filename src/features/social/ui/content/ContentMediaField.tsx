import { useState } from "react";
import { t } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";
import { Text } from "../../../../shared/ui/Text";
import { TextField } from "../../../../shared/ui/TextField";
import { FileField } from "../../../../shared/ui/FileField";
import type { SocialClient } from "../../model/socialClient";
import { uploadForSocialEditor, type SocialMediaEditor } from "../../model/socialMediaEditor";
import type { ContentMedia } from "./contentDraft";
import { probeVideo } from "./mediaProbe";
import { presentRemoteError } from "../../../connections/public/remoteFailure";

const IMAGE_TYPES = ["image/jpeg", "image/png"];
const VIDEO_TYPE = "video/mp4";
const PDF_TYPE = "application/pdf";

export type ContentMediaFieldProps = {
  client: SocialClient;
  editor: SocialMediaEditor;
  media: ContentMedia[];
  disabled: boolean;
  allowDocument?: boolean;
  /** Why attaching is off (for example the account cannot upload media). */
  disabledReason?: string;
  onChange: (next: ContentMedia[]) => void;
  onBusyChange?: (busy: boolean) => void;
};

/** Attach images or one video. Rules per platform are checked in the preview and the publish gate. */
export function ContentMediaField({
  client,
  editor,
  media,
  disabled,
  allowDocument,
  disabledReason,
  onChange,
  onBusyChange,
}: ContentMediaFieldProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const add = async (files: File[]) => {
    setBusy(true);
    onBusyChange?.(true);
    setError(undefined);
    try {
      // Refuse the whole pick before any upload, so a batch with one bad file uploads nothing.
      const types = [...IMAGE_TYPES, VIDEO_TYPE, ...(allowDocument ? [PDF_TYPE] : [])];
      if (files.some((file) => !types.includes(file.type)))
        throw new Error(
          allowDocument
            ? t("Use JPEG or PNG images, one MP4 video, or one PDF document.")
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
        const upload = await uploadForSocialEditor(editor, client, file);
        const isVideo = file.type === VIDEO_TYPE;
        const isDocument = file.type === PDF_TYPE;
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
  const remove = (item: ContentMedia) => {
    onChange(media.filter((other) => other.localId !== item.localId));
    if (item.mediaId) void editor.releaseCurrent(item.mediaId).catch(() => {});
  };
  return (
    <div className="content-media">
      <FileField
        label={allowDocument ? t("Images, video or PDF") : t("Images or one video")}
        multiple
        accept={
          allowDocument
            ? "image/jpeg,image/png,video/mp4,application/pdf"
            : "image/jpeg,image/png,video/mp4"
        }
        disabled={disabled || busy}
        description={disabledReason ?? (busy ? t("Uploading…") : undefined)}
        hint={
          allowDocument
            ? t("Use JPEG or PNG images, one MP4 video, or one PDF document.")
            : t("JPEG or PNG images, or one MP4 video.")
        }
        error={error}
        onFiles={(files) =>
          void add(files).catch(() => setError(t("The file could not be attached.")))
        }
      />
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
