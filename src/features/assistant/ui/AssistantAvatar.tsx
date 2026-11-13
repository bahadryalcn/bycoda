import { useEffect, useState } from "react";
import type { AssistantProfilePatch } from "../../../shared/model/host-contracts/assistant";
import { t } from "../../../shared/i18n";
import { RadioGroup } from "../../../shared/ui/RadioGroup";
import { optionalTextAttributes, Text, type TextRoles } from "../../../shared/ui/Text";
import { TextField } from "../../../shared/ui/TextField";
import {
  ASSISTANT_AVATAR_PRESETS,
  DEFAULT_ASSISTANT_AVATAR,
  assistantAvatarGeneratedValue,
  assistantAvatarImageUrl,
  assistantAvatarPresetValue,
  assistantAvatarView,
} from "../model/assistantAvatar";
import { loadGeneratedAvatar } from "../model/generatedAvatarCache";
import { AvatarGenerator } from "./builder/AvatarGenerator";
import styles from "./AssistantAvatar.module.css";

const DEFAULT_PORTRAIT = assistantAvatarImageUrl(DEFAULT_ASSISTANT_AVATAR);

/**
 * The data URL of a generated portrait, read from the Host once per id. While it loads, and when
 * the read fails, `undefined` makes the caller draw the default portrait.
 */
function useGeneratedAvatarSrc(id: string): string | undefined {
  const [loaded, setLoaded] = useState<{ id: string; src: string } | null>(null);
  useEffect(() => {
    let live = true;
    loadGeneratedAvatar(id)
      .then((src) => {
        if (live) setLoaded({ id, src });
      })
      // A failed read leaves the default portrait; the next mount reads again.
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [id]);
  return loaded?.id === id ? loaded.src : undefined;
}

function GeneratedPortrait({ id, className }: { id: string; className: string }) {
  const src = useGeneratedAvatarSrc(id);
  return (
    <img
      className={className}
      src={src ?? DEFAULT_PORTRAIT}
      alt=""
      draggable={false}
      onError={(event) => {
        if (src) event.currentTarget.src = DEFAULT_PORTRAIT;
      }}
    />
  );
}

/**
 * The assistant's portrait, emoji or initials. Decorative: the name always sits next to it. A
 * portrait that fails to load leaves the box empty, so the CSS draws the name's first letter.
 */
export function AssistantAvatarMark({
  value,
  name,
  className,
  size,
  tone,
  weight,
  leading,
}: {
  value: string | undefined;
  name: string;
  /** Placement only (box size, radius, background); type roles are props. */
  className?: string;
} & Pick<TextRoles, "size" | "tone" | "weight" | "leading">) {
  const view = assistantAvatarView(value);
  const [failed, setFailed] = useState("");
  return (
    <span
      {...optionalTextAttributes({ size, tone, weight, leading }, className)}
      aria-hidden="true"
      data-initial={Array.from(name)[0]?.toLocaleUpperCase() ?? ""}
      data-avatar={view.kind}
    >
      {view.kind === "text" ? (
        view.text
      ) : view.kind === "generated" ? (
        <GeneratedPortrait id={view.id} className={styles.image} />
      ) : failed === view.src ? null : (
        <img
          className={styles.image}
          src={view.src}
          alt=""
          draggable={false}
          onError={() => setFailed(view.src)}
        />
      )}
    </span>
  );
}

/** Portrait tiles (bundled and AI-generated), a free emoji or initials field and an AI generator; clearing the field returns to the default portrait. */
export function AssistantAvatarPicker({
  value,
  hideLabel,
  onChange,
}: {
  value: string | undefined;
  hideLabel: boolean;
  onChange: (patch: AssistantProfilePatch) => void;
}) {
  const view = assistantAvatarView(value);
  /** Avatars drawn in this picker, so the owner can switch between them before saving. */
  const [drawn, setDrawn] = useState<string[]>([]);
  const current = view.kind === "generated" ? assistantAvatarGeneratedValue(view.id) : undefined;
  const generated = current && !drawn.includes(current) ? [...drawn, current] : drawn;
  return (
    <div className={styles.picker}>
      <RadioGroup
        variant="tiles"
        label={t("Avatar")}
        className={styles.tiles}
        tileClassName={styles.tile}
        tile={{ shape: "pill", selectionIndicator: "border-ring" }}
        value={view.kind === "image" ? assistantAvatarPresetValue(view.id) : (current ?? "")}
        onValueChange={(next) => onChange({ avatar: next })}
        options={[
          ...ASSISTANT_AVATAR_PRESETS.map((preset) => ({
            value: assistantAvatarPresetValue(preset.id),
            ariaLabel: t(preset.label),
            tooltip: t(preset.label),
            content: (
              <img
                className={styles.tileImage}
                src={assistantAvatarImageUrl(preset.id)}
                alt=""
                draggable={false}
              />
            ),
          })),
          ...generated.map((avatar, index) => ({
            value: avatar,
            ariaLabel: t("Generated avatar {p0}", { p0: index + 1 }),
            tooltip: t("Generated avatar {p0}", { p0: index + 1 }),
            content: (
              <GeneratedPortrait id={avatar.slice("image:".length)} className={styles.tileImage} />
            ),
          })),
        ]}
      />
      <TextField
        label={t("Emoji or initials")}
        hideLabel={hideLabel}
        value={view.kind === "text" ? view.text : ""}
        maxLength={200}
        placeholder={t("Emoji or initials")}
        onChange={(event) => onChange({ avatar: event.currentTarget.value })}
      />
      <div className={styles.generate}>
        <Text leading="inherit">{t("Generate with AI")}</Text>
        <AvatarGenerator
          onGenerated={(avatar) => {
            setDrawn((list) => (list.includes(avatar) ? list : [...list, avatar]));
            onChange({ avatar });
          }}
        />
      </div>
    </div>
  );
}
