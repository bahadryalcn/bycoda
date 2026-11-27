import { useState, type CSSProperties } from "react";
import { formatDate, t, useLocale } from "../../../../../shared/i18n";
import { Code } from "../../../../../shared/ui/Code";
import { CopyButton } from "../../../../../shared/ui/CopyButton";
import { FileReferenceBody, fileReferenceChip } from "../../../../files/public/FileReference";
import { Disclosure } from "../../../../../shared/ui/Disclosure";
import { File, Terminal } from "../../../../../shared/ui/icons";
import { Segmented } from "../../../../../shared/ui/settings";
import { Surface } from "../../../../../shared/ui/Surface";
import { Text } from "../../../../../shared/ui/Text";
import { chatBackgroundSrc } from "../../../model/appearance";
import {
  fileRefHueVars,
  type AppearancePreferences,
  type FileToneField,
} from "../../../model/appearancePreferences";
import type { AppearanceSettings } from "../../useAppearanceSettings";
import styles from "./TranscriptPreview.module.css";

/** The reading settings the preview shows: stored preferences with any slider draft on top. */
export type TranscriptPreviewValues = Pick<
  AppearancePreferences,
  | "transcriptSurface"
  | "transcriptSurfaceOpacity"
  | "transcriptSurfaceBlur"
  | "transcriptBodyInk"
  | "transcriptChromeInk"
  | "transcriptCards"
  | "transcriptActions"
  | "transcriptFileRefs"
  | FileToneField
  | "userMessageOpacity"
  | "messageColor"
>;

/** File names the preview shows as references: name, whether it is a folder, and the label. */
const PREVIEW_REFERENCES = [
  ["math.ts", false, "math.ts:14"],
  ["index.html", false, "index.html"],
  ["notes.md", false, "notes.md"],
  ["rows.csv", false, "rows.csv"],
  ["logo.png", false, "logo.png"],
  ["backup.zip", false, "backup.zip"],
  ["src", true, "src/"],
] as const;

/**
 * Sticky live preview of the transcript reading rules. It renders the shared markup (reply
 * wrapper, step rows, markdown, card, actions row) under a `[data-transcript-preview]` root, so
 * `styles/transcript-surface.css` styles it exactly as it styles the transcript; this file draws
 * only the frame and the backdrop. Not interactive: the content is `inert`.
 * @group display
 * @use Settings > Chat, above the reading presets.
 * @avoid A second copy of reading rules: add them to styles/transcript-surface.css.
 */
export function TranscriptPreview({
  appearance,
  values,
}: {
  appearance: AppearanceSettings;
  values: TranscriptPreviewValues;
}) {
  useLocale();
  const [backdrop, setBackdrop] = useState<"image" | "plain">("image");
  const image = chatBackgroundSrc(appearance.chatBackgroundPath);
  const art =
    backdrop === "plain" ? null : image ? (
      <div
        className={styles.art}
        style={{
          backgroundImage: `url("${image}")`,
          opacity: appearance.chatBackgroundSessionOpacity,
        }}
      />
    ) : (
      <div className={`${styles.art} ${styles.sample}`} />
    );
  return (
    <div className={styles.dock}>
      <div
        data-transcript-preview=""
        data-transcript-surface={values.transcriptSurface}
        data-transcript-cards={values.transcriptCards}
        data-transcript-actions={values.transcriptActions}
        data-file-refs={values.transcriptFileRefs}
        data-chat-message-color={values.messageColor}
        data-chat-user-surface-off={values.userMessageOpacity === 0 ? "" : undefined}
        className={styles.stage}
        style={
          {
            "--appearance-user-message-opacity": `${values.userMessageOpacity}%`,
            "--appearance-transcript-surface-opacity": `${values.transcriptSurfaceOpacity}%`,
            "--appearance-transcript-surface-blur": `${values.transcriptSurfaceBlur}px`,
            "--appearance-transcript-body-ink": `${values.transcriptBodyInk}%`,
            "--appearance-transcript-chrome-ink": `${values.transcriptChromeInk}%`,
            ...fileRefHueVars(values),
          } as CSSProperties
        }
      >
        {art}
        <div className={`transcript-content ${styles.scene}`} inert>
          <div data-chat-message-surface="user" className={styles.bubble}>
            <Text size="caption">{t("Run the tests and fix what fails.")}</Text>
          </div>
          <div data-transcript-reply="" className={styles.reply}>
            <Disclosure variant="step" chevron="end" summary={t("Worked for 14s")} />
            <Disclosure
              variant="step"
              collapsible={false}
              summary={
                <span className="inline-flex items-center gap-1.5">
                  <Terminal aria-hidden="true" />
                  <span>{t("Ran pnpm test")}</span>
                  <span className={styles.chip}>
                    <File aria-hidden="true" />
                    {t("math.ts")}
                  </span>
                </span>
              }
            />
            <div className="agent-markdown">
              <p>
                {t("The failing case was an off-by-one in")} <code>{t("sum()")}</code>.{" "}
                <strong>{t("All tests pass now.")}</strong>
              </p>
              <p>{t("I also added a regression test so it stays fixed.")}</p>
              <p className={styles.refs}>
                {PREVIEW_REFERENCES.map(([name, isDir, label]) => (
                  // Same chip as a reply: shared inline code at caption size with the reference's tint.
                  <Code
                    key={name}
                    variant="chip"
                    size="caption"
                    {...fileReferenceChip(name, isDir)}
                  >
                    <FileReferenceBody name={name} isDir={isDir}>
                      {label}
                    </FileReferenceBody>
                  </Code>
                ))}
              </p>
            </div>
            <pre className={styles.code}>{"const sum = (a, b) => a + b;"}</pre>
            <Surface variant="card" padding="sm">
              <Text size="caption" tone="secondary">
                {t("Changed 2 files")}
              </Text>
            </Surface>
            <div data-transcript-actions-row="" className={styles.actions}>
              <CopyButton variant="ghost" iconOnly label={t("Copy")} text="" />
              <Text size="caption" tone="inherit">
                {formatDate(new Date(0), { hour: "numeric", minute: "2-digit", timeZone: "UTC" })}
              </Text>
            </div>
          </div>
        </div>
      </div>
      <Segmented
        label={t("Preview backdrop")}
        value={backdrop}
        options={[
          { value: "image", label: t("Background") },
          { value: "plain", label: t("Plain") },
        ]}
        onChange={setBackdrop}
      />
    </div>
  );
}
