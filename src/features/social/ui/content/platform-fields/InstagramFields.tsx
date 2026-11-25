import { formatNumber, t } from "../../../../../shared/i18n";
import { Button } from "../../../../../shared/ui/Button";
import { Checkbox } from "../../../../../shared/ui/Checkbox";
import { Disclosure } from "../../../../../shared/ui/Disclosure";
import { FieldGroup } from "../../../../../shared/ui/FieldGroup";
import { NumberField } from "../../../../../shared/ui/NumberField";
import { Select } from "../../../../../shared/ui/Select";
import { TextField } from "../../../../../shared/ui/TextField";
import { Text } from "../../../../../shared/ui/Text";
import type { ContentMedia, InstagramDraft, InstagramTagDraft } from "../contentDraft";
import type { PlatformFieldProps } from "./PlatformFields";

function InstagramTags({
  media,
  story,
  tags,
  disabled,
  onChange,
}: {
  media: ContentMedia[];
  story: boolean;
  tags: InstagramTagDraft[];
  disabled: boolean;
  onChange: (tags: InstagramTagDraft[]) => void;
}) {
  const targets = media
    .filter((item) => item.media.kind !== "document")
    .map((item, index) => ({
      value: item.localId,
      label: t("{p0}. {p1}", { p0: formatNumber(index + 1), p1: item.name }),
    }));
  if (!targets.length && !tags.length) return null;
  const update = (id: string, patch: Partial<InstagramTagDraft>) =>
    onChange(tags.map((tag) => (tag.id === id ? { ...tag, ...patch } : tag)));
  return (
    <FieldGroup legend={t("Instagram user tags")} disabled={disabled}>
      {tags.map((tag) => {
        const target = media.find((item) => item.localId === tag.localMediaId);
        return (
          <FieldGroup key={tag.id} variant="bare">
            <TextField
              label={t("Tag username")}
              value={tag.username}
              maxLength={30}
              onChange={(event) => update(tag.id, { username: event.target.value })}
            />
            <Select
              label={t("Tagged attachment")}
              value={target?.localId ?? ""}
              options={[
                {
                  value: "",
                  label:
                    target || !tag.localMediaId
                      ? t("Choose an attachment")
                      : t("Tagged attachment was removed"),
                  disabled: true,
                },
                ...targets,
              ]}
              disabled={disabled}
              onValueChange={(localMediaId) => update(tag.id, { localMediaId })}
            />
            {target &&
            (story ||
              target.media.kind === "image" ||
              tag.x !== undefined ||
              tag.y !== undefined) ? (
              <FieldGroup legend={t("Position")} hideLegend layout="row">
                <NumberField
                  label={t("Horizontal position (0–1)")}
                  value={tag.x ?? ""}
                  min={0}
                  max={1}
                  step={0.01}
                  steppers={false}
                  onChange={(event) =>
                    update(tag.id, {
                      x: event.target.value === "" ? undefined : event.target.valueAsNumber,
                    })
                  }
                />
                <NumberField
                  label={t("Vertical position (0–1)")}
                  value={tag.y ?? ""}
                  min={0}
                  max={1}
                  step={0.01}
                  steppers={false}
                  onChange={(event) =>
                    update(tag.id, {
                      y: event.target.value === "" ? undefined : event.target.valueAsNumber,
                    })
                  }
                />
              </FieldGroup>
            ) : null}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onChange(tags.filter((item) => item.id !== tag.id))}
            >
              {t("Remove Instagram tag")}
            </Button>
          </FieldGroup>
        );
      })}
      <Button
        size="sm"
        disabled={!targets.length || tags.length >= 20}
        disabledReason={
          tags.length >= 20
            ? t("An Instagram post can have at most 20 tags.")
            : t("Attach an image to tag people.")
        }
        onClick={() =>
          onChange([
            ...tags,
            {
              id: crypto.randomUUID(),
              localMediaId: targets.length === 1 ? targets[0].value : undefined,
              username: "",
            },
          ])
        }
      >
        {t("Add Instagram tag")}
      </Button>
    </FieldGroup>
  );
}

export function InstagramFields({ account, media, value, disabled, onChange }: PlatformFieldProps) {
  const options = value.instagram ?? {};
  const story = options.format === "story";
  const change = (next: Partial<InstagramDraft>) =>
    onChange({ ...value, instagram: { ...options, ...next } });
  return (
    <FieldGroup legend={t("Instagram publishing")} hideLegend disabled={disabled}>
      <Select
        label={t("Instagram format")}
        disabled={disabled}
        value={story ? "story" : "feed"}
        options={[
          { value: "feed", label: t("Feed post or Reel") },
          {
            value: "story",
            label: t("Story"),
            disabled: !!account.instagramAccountType && account.instagramAccountType !== "BUSINESS",
          },
        ]}
        onValueChange={(format) => change({ format: format === "story" ? "story" : undefined })}
      />
      {story ? (
        <Text size="caption" tone="muted">
          {t("Stories use one image or video and require an Instagram Business account.")}{" "}
          {t(
            "Caption, link, collaborators, location and alt text apply only to feed posts and Reels.",
          )}
        </Text>
      ) : (
        <>
          {media
            .filter((item) => item.media.kind === "image")
            .map((item) => (
              <TextField
                key={item.localId}
                label={t("Alt text for {p0}", { p0: item.name })}
                value={options.altText?.[item.localId] ?? item.media.alt ?? ""}
                maxLength={1000}
                onChange={(event) =>
                  change({
                    altText: { ...options.altText, [item.localId]: event.target.value },
                  })
                }
              />
            ))}
        </>
      )}
      <Checkbox
        size="body"
        checked={options.isAiGenerated ?? false}
        label={t("Label as AI-generated")}
        onChange={(event) => change({ isAiGenerated: event.target.checked })}
      />
      {story ? null : (
        <Disclosure summary={t("More Instagram options")} variant="row" size="sm">
          <div className="content-platform-more">
            <TextField
              label={t("Instagram collaborators")}
              description={t("Enter up to three usernames, separated by commas.")}
              defaultValue={options.collaborators?.join(", ") ?? ""}
              onChange={(event) =>
                change({
                  collaborators: event.target.value
                    .split(",")
                    .map((value) => value.trim())
                    .filter(Boolean),
                })
              }
            />
            <TextField
              label={t("Instagram location ID")}
              inputMode="numeric"
              value={options.locationId ?? ""}
              onChange={(event) => change({ locationId: event.target.value || undefined })}
            />
            <InstagramTags
              media={media}
              story={story}
              tags={options.userTags ?? []}
              disabled={disabled}
              onChange={(userTags) => change({ userTags })}
            />
          </div>
        </Disclosure>
      )}
      {story ? (
        <InstagramTags
          media={media}
          story={story}
          tags={options.userTags ?? []}
          disabled={disabled}
          onChange={(userTags) => change({ userTags })}
        />
      ) : null}
    </FieldGroup>
  );
}
