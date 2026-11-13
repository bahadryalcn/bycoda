import { useState } from "react";
import { t } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";
import { Text } from "../../../../shared/ui/Text";
import { FileField } from "../../../../shared/ui/FileField";
import type { SocialClient } from "../../model/socialClient";
import { uploadForSocialEditor, type SocialMediaEditor } from "../../model/socialMediaEditor";
import type { ContentMedia } from "./contentDraft";
import { probeVideo } from "./mediaProbe";

const IMAGE_TYPES = ["image/jpeg", "image/png"];
const VIDEO_TYPE = "video/mp4";

export type ContentMediaFieldProps = {
  client: SocialClient;
  editor: SocialMediaEditor;
  media: ContentMedia[];
  disabled: boolean;
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
      if (files.some((file) => ![...IMAGE_TYPES, VIDEO_TYPE].includes(file.type)))
        throw new Error(t("Use JPEG or PNG images, or one MP4 video."));
      const added: ContentMedia[] = [];
      for (const file of files) {
        const upload = await uploadForSocialEditor(editor, client, file);
        const isVideo = file.type === VIDEO_TYPE;
        const probe = isVideo ? await probeVideo(file).catch(() => undefined) : undefined;
        added.push({
          localId: upload.uploadId,
          name: file.name,
          media: { kind: isVideo ? "video" : "image", uploadId: upload.uploadId },
          probe,
          mediaId: upload.managed?.mediaId,
        });
      }
      onChange([...media, ...added]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("The file could not be attached."));
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
        label={t("Images or one video")}
        multiple
        accept="image/jpeg,image/png,video/mp4"
        disabled={disabled || busy}
        description={disabledReason ?? (busy ? t("Uploading…") : undefined)}
        hint={t("JPEG or PNG images, or one MP4 video.")}
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
    </div>
  );
}
