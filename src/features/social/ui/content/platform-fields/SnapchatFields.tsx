import { t } from "../../../../../shared/i18n";
import { FieldGroup } from "../../../../../shared/ui/FieldGroup";
import { Select } from "../../../../../shared/ui/Select";
import { TextField } from "../../../../../shared/ui/TextField";
import { surfaceAttributes } from "../../../../../shared/ui/Surface";
import type { PlatformDraft } from "../contentDraft";
import type { PlatformFieldProps } from "./PlatformFields";

type Options = NonNullable<PlatformDraft["snapchat"]>;

export function SnapchatFields({ account, value, disabled, onChange }: PlatformFieldProps) {
  const options = value.snapchat;
  const api = account.connection !== "browser";
  const set = (snapchat: Options) => onChange({ ...value, snapchat });
  const sources = (options?.savedStorySources ?? [])
    .map(({ kind, id }) => `${kind}:${id}`)
    .join(", ");
  return (
    <FieldGroup
      legend="Snapchat"
      {...surfaceAttributes({ frame: "pane", edge: "block-start" }, "content-platform")}
      disabled={disabled}
    >
      <Select
        label={t("Snapchat publishing format")}
        value={options?.target ?? ""}
        disabled={disabled}
        options={[
          { value: "", label: t("Choose a Snapchat publishing format."), disabled: true },
          { value: "spotlight", label: "Spotlight" },
          { value: "story", label: t("Public Story") },
          ...(api ? [{ value: "saved_story", label: t("Saved Story") }] : []),
        ]}
        onValueChange={(target) => {
          if (target === "spotlight" || target === "story" || target === "saved_story")
            set({ target });
        }}
      />
      {api && options?.target === "spotlight" && (
        <TextField
          label={t("Spotlight locale")}
          placeholder="tr_TR"
          maxLength={5}
          value={options.locale ?? ""}
          onChange={(event) => set({ ...options, locale: event.target.value })}
        />
      )}
      {api && options?.target === "story" && (
        <Select
          label={t("Story expiry")}
          value={options.storyTtl ?? "ONE_DAY"}
          disabled={disabled}
          options={[
            { value: "ONE_DAY", label: t("1 day") },
            { value: "TWO_DAYS", label: t("2 days") },
            { value: "THREE_DAYS", label: t("3 days") },
            { value: "ONE_WEEK", label: t("1 week") },
          ]}
          onValueChange={(storyTtl) =>
            set({ ...options, storyTtl: storyTtl as Options["storyTtl"] })
          }
        />
      )}
      {api && (options?.target === "spotlight" || options?.target === "story") && (
        <TextField
          label={t("Link sticker text")}
          maxLength={40}
          value={options.linkStickerText ?? ""}
          onChange={(event) =>
            set({ ...options, linkStickerText: event.target.value || undefined })
          }
        />
      )}
      {api && options?.target === "saved_story" && (
        <TextField
          label={t("Saved Story source IDs")}
          description={t(
            "Use the post text as the title. Attach media or enter comma-separated IDs in snap:ID or spotlight:ID format.",
          )}
          value={options.sourceText ?? sources}
          onChange={(event) => set({ ...options, sourceText: event.target.value })}
        />
      )}
    </FieldGroup>
  );
}
