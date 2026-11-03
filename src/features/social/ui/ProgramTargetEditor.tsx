import { useEffect, useRef, useState } from "react";
import { useContext as useSocialContext } from "react";
import { NativeSelect } from "../../../shared/ui/Select";
import { TextField } from "../../../shared/ui/TextField";
import { TextareaField } from "../../../shared/ui/TextareaField";
import { Badge } from "../../../shared/ui/Badge";
import { Button } from "../../../shared/ui/Button";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { t } from "../../../shared/i18n";
import {
  PROGRAM_STEPS,
  type ProgramTarget,
  type SocialOccurrence,
  type SocialProgram,
} from "../model/socialProgram";
import { PROGRAM_STEP_LABELS } from "../model/socialProgramForm";
import type { CampaignVariant } from "../model/social";
import { ProgramLabel, programStates } from "./ProgramFormShared";
import { SocialBusyContext as SocialLockContext } from "./socialContext";
import { Notice, names, type Props } from "./socialShared";
import { useSocialPending } from "./useSocialPending";

type TargetEditorProps = {
  accountName?: string;
  target: ProgramTarget;
  occurrence: SocialOccurrence;
  program: SocialProgram;
  busy: boolean;
  perform: (action: string, input: Record<string, unknown>) => Promise<boolean>;
  client: Props["client"];
};

/**
 * Owns the owner's unsaved edits and step selection. The preview state below is keyed by the
 * stored media so a changed media set starts clean without discarding those edits.
 */
export function ProgramTargetEditor(props: TargetEditorProps) {
  const [draft, setDraft] = useState<CampaignVariant | undefined>();
  const [selectedSteps, setSelectedSteps] = useState<string[]>([]);
  const mediaKey = props.target.variant?.media.map((m) => m.uploadId ?? m.url).join("|") ?? "";
  return (
    <TargetEditorBody
      key={mediaKey}
      {...props}
      draft={draft}
      setDraft={setDraft}
      selectedSteps={selectedSteps}
      setSelectedSteps={setSelectedSteps}
    />
  );
}

function TargetEditorBody({
  target,
  occurrence,
  program,
  busy,
  perform,
  client,
  accountName,
  draft,
  setDraft,
  selectedSteps,
  setSelectedSteps,
}: TargetEditorProps & {
  draft: CampaignVariant | undefined;
  setDraft: (variant: CampaignVariant | undefined) => void;
  selectedSteps: string[];
  setSelectedSteps: (steps: string[]) => void;
}) {
  const pendingUi = useSocialPending();
  const socialLocked = useSocialContext(SocialLockContext);
  const [images, setImages] = useState<Record<string, string>>({}),
    [imageErrors, setImageErrors] = useState<Record<string, boolean>>({}),
    [urlRetries, setUrlRetries] = useState<Record<string, boolean>>({});
  const imageVersion = useRef(0);
  // An unsaved edit replaces the stored variant until it is saved.
  const variant = draft ?? target.variant;
  useEffect(
    () => () => {
      // Late preview responses of a replaced or unmounted editor are dropped.
      imageVersion.current++;
    },
    [],
  );
  const ids = { id: program.id, occurrenceId: occurrence.id, accountId: target.accountId };
  const previewImage = async (uploadId: string) => {
    const version = imageVersion.current;
    try {
      const result = await client.request<{ base64: string; mime: string }>(
        "programs.media-preview",
        { uploadId },
      );
      if (version === imageVersion.current) {
        setImages((current) => ({
          ...current,
          [uploadId]: `data:${result.mime};base64,${result.base64}`,
        }));
        setImageErrors((current) => ({ ...current, [uploadId]: false }));
      }
    } catch {
      if (version === imageVersion.current)
        setImageErrors((current) => ({ ...current, [uploadId]: true }));
    }
  };
  return (
    <section className="social-program-target">
      <strong>
        {names[target.platform]} · {t(programStates[target.status] ?? target.status)}
      </strong>
      <p>
        {target.textAgent?.provider} {target.textAgent?.model} {target.imageProvider}{" "}
        {target.imageModel}
      </p>
      {target.error ? <Notice kind="warning">{target.error}</Notice> : null}
      {target.status === "generating" && target.generation.imageProgress !== undefined ? (
        <p>
          {t("Image step progress")}: {target.generation.imageProgress}%
        </p>
      ) : null}
      {!variant && !target.jobId && target.status !== "generating" ? (
        <Button
          type="button"
          variant="secondary"
          loading={pendingUi.is("target-editor.regenerate")}
          disabled={socialLocked || busy}
          onClick={() =>
            void pendingUi.run("target-editor.regenerate", () =>
              perform("programs.regenerate", ids),
            )
          }
        >
          {t("Regenerate")}
        </Button>
      ) : null}
      {target.imageProvider === "comfyui" &&
      target.generation.providerJobId &&
      variant &&
      !variant.media.length &&
      target.status === "review" ? (
        <Button
          type="button"
          variant="secondary"
          loading={pendingUi.is("target-editor.resume-existing-image-job")}
          disabled={socialLocked || busy}
          onClick={() =>
            void pendingUi.run("target-editor.resume-existing-image-job", () =>
              perform("programs.resume-image", ids),
            )
          }
        >
          {t("Resume existing image job")}
        </Button>
      ) : null}
      {variant ? (
        <>
          <TextareaField
            label={t("Platform content")}
            rows={3}
            disabled={socialLocked || busy || !!target.jobId || target.status === "generating"}
            value={variant.text}
            onChange={(e) => {
              setDraft({ ...variant, text: e.target.value });
            }}
          />
          <TextField
            label={t("Public link")}
            type="url"
            disabled={socialLocked || busy || !!target.jobId}
            value={variant.link ?? ""}
            onChange={(e) => {
              setDraft({ ...variant, link: e.target.value || undefined });
            }}
          />
          {variant.youtube ? (
            <>
              <TextField
                label={t("Video title")}
                disabled={socialLocked || busy || !!target.jobId}
                value={variant.youtube.title}
                onChange={(e) => {
                  setDraft({
                    ...variant,
                    youtube: { ...variant.youtube!, title: e.target.value },
                  });
                }}
              />
              <ProgramLabel text="Video visibility">
                <NativeSelect
                  disabled={socialLocked || busy || !!target.jobId}
                  value={variant.youtube.privacy}
                  onChange={(e) => {
                    setDraft({
                      ...variant,
                      youtube: {
                        ...variant.youtube!,
                        privacy: e.target.value as "private" | "unlisted" | "public",
                      },
                    });
                  }}
                >
                  {["private", "unlisted", "public"].map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </NativeSelect>
              </ProgramLabel>
            </>
          ) : null}
          {variant.media.map((media, i) => (
            <div key={i}>
              {media.kind === "image" ? (
                <>
                  {media.url && (!imageErrors[media.url] || urlRetries[media.url]) ? (
                    <img
                      src={media.url}
                      alt={media.alt ?? ""}
                      referrerPolicy="no-referrer"
                      onLoad={() => {
                        setImageErrors((current) => ({ ...current, [media.url!]: false }));
                        setUrlRetries((current) => ({ ...current, [media.url!]: false }));
                      }}
                      onError={() => {
                        setImageErrors((current) => ({ ...current, [media.url!]: true }));
                        setUrlRetries((current) => ({ ...current, [media.url!]: false }));
                      }}
                    />
                  ) : media.url ? null : media.uploadId && images[media.uploadId] ? (
                    <img
                      src={images[media.uploadId]}
                      alt={media.alt ?? ""}
                      onError={() => {
                        setImages((current) => ({ ...current, [media.uploadId!]: "" }));
                        setImageErrors((current) => ({ ...current, [media.uploadId!]: true }));
                      }}
                    />
                  ) : media.uploadId ? (
                    <Button
                      type="button"
                      variant="secondary"
                      loading={pendingUi.is(`target-editor.preview-generated-image:${i}`)}
                      disabled={socialLocked || busy}
                      onClick={() =>
                        void pendingUi.run(`target-editor.preview-generated-image:${i}`, () =>
                          previewImage(media.uploadId!),
                        )
                      }
                    >
                      {media.uploadId && imageErrors[media.uploadId]
                        ? t("Retry")
                        : t("Preview generated image")}
                    </Button>
                  ) : (
                    <Notice kind="warning">{t("No image")}</Notice>
                  )}
                  {media.url && imageErrors[media.url] ? (
                    <Button
                      type="button"
                      variant="secondary"
                      loading={!!urlRetries[media.url]}
                      disabled={socialLocked || busy}
                      onClick={() =>
                        setUrlRetries((current) => ({ ...current, [media.url!]: true }))
                      }
                    >
                      {t("Retry")}
                    </Button>
                  ) : null}
                  {imageErrors[media.url ?? media.uploadId ?? ""] ? (
                    <Notice kind="error">
                      {t("Preview generated image")}: {t("Failed")}
                    </Notice>
                  ) : null}
                  <TextField
                    label={t("Image alt text")}
                    disabled={socialLocked || busy || !!target.jobId}
                    value={media.alt ?? ""}
                    onChange={(e) => {
                      setDraft({
                        ...variant,
                        media: variant.media.map((m, index) =>
                          index === i ? { ...m, alt: e.target.value } : m,
                        ),
                      });
                    }}
                  />
                </>
              ) : (
                <p>{t("Uploaded video")}</p>
              )}
            </div>
          ))}
          {!target.jobId ? (
            <div className="social-toolbar-actions">
              <Button
                type="button"
                variant="secondary"
                loading={pendingUi.is("target-editor.save-content-changes")}
                disabled={socialLocked || busy || target.status === "generating"}
                onClick={() =>
                  void pendingUi
                    .run("target-editor.save-content-changes", () =>
                      perform("programs.edit", {
                        ...ids,
                        expectedRevision: occurrence.revision,
                        variant,
                      }),
                    )
                    .then((saved) => {
                      if (saved) {
                        setDraft(undefined);
                        setSelectedSteps([]);
                      }
                    })
                }
              >
                {t("Save content changes")}
              </Button>
              <Button
                type="button"
                variant="secondary"
                loading={pendingUi.is("target-editor.regenerate")}
                disabled={socialLocked || busy || target.status === "generating"}
                onClick={() =>
                  void pendingUi.run("target-editor.regenerate", () =>
                    perform("programs.regenerate", ids),
                  )
                }
              >
                {t("Regenerate")}
              </Button>
              <div className="social-program-days">
                {PROGRAM_STEPS.filter((s) => s !== "image" || program.image.mode !== "none").map(
                  (step) => (
                    <label key={step}>
                      <Checkbox
                        disabled={socialLocked}
                        checked={selectedSteps.includes(step)}
                        onChange={(e) =>
                          setSelectedSteps(
                            e.target.checked
                              ? [...selectedSteps, step]
                              : selectedSteps.filter((s) => s !== step),
                          )
                        }
                      />
                      {t(PROGRAM_STEP_LABELS[step])}
                      {target.approvals[step] ? " ✓" : ""}
                    </label>
                  ),
                )}
              </div>
              <Badge variant="label" appearance="outline">
                {accountName ?? target.accountId} · {names[target.platform]}
              </Badge>
              <Button
                type="button"
                variant="secondary"
                loading={pendingUi.is("target-editor.approve-selected-steps")}
                disabled={
                  socialLocked ||
                  busy ||
                  draft !== undefined ||
                  !selectedSteps.length ||
                  target.status === "generating"
                }
                onClick={() =>
                  void pendingUi.run("target-editor.approve-selected-steps", () =>
                    perform("programs.approve", {
                      ...ids,
                      expectedRevision: occurrence.revision,
                      confirm: true,
                      steps: selectedSteps,
                    }),
                  )
                }
              >
                {t("Approve selected steps")}
              </Button>
            </div>
          ) : null}
        </>
      ) : null}
      {target.generation.transitions.length ? (
        <details>
          <summary>{t("Provider selection history")}</summary>
          {target.generation.transitions.map((s, i) => (
            <p key={i}>{s}</p>
          ))}
        </details>
      ) : null}
      {target.jobId ? (
        <p>
          {t("Job")}: {target.jobId}
        </p>
      ) : null}
      {target.platformId ? (
        <p>
          {t("Platform post")}:{" "}
          {target.url ? (
            <a href={target.url} target="_blank" rel="noopener noreferrer">
              {target.platformId}
            </a>
          ) : (
            target.platformId
          )}
        </p>
      ) : null}
    </section>
  );
}
