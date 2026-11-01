import { useContext, useId, useState } from "react";
import { dateTimeFormat } from "../../../shared/lib/intl";
import { getLocale, t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { NativeSearchableSelect } from "../../../shared/ui/NativeSearchableSelect";
import { Progress } from "../../../shared/ui/Progress";
import { RadioGroup } from "../../../shared/ui/RadioGroup";
import { NativeSelect } from "../../../shared/ui/Select";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { TextField } from "../../../shared/ui/TextField";
import { NumberField } from "../../../shared/ui/NumberField";
import { DateTimeField } from "../../../shared/ui/DateTimePicker";
import { TextareaField } from "../../../shared/ui/TextareaField";
import { SocialModelField } from "./SocialModelField";
import {
  defaultProgram,
  programApprovalSteps,
  PROGRAM_STEPS,
  type ProgramConfig,
  type ProgramFeatures,
  type SocialProgram,
} from "../model/socialProgram";
import {
  localDateTimeInput,
  programConfigFromProgram,
  PROGRAM_STEP_LABELS,
  PROGRAM_SUGGESTION_FIELD_LABELS,
  summarizeProgramSuggestion,
} from "../model/socialProgramForm";
import { ProgramLabel } from "./ProgramFormShared";
import { SocialBusyContext } from "./socialContext";
import { SocialMultiSelect } from "./SocialMultiSelect";
import { Notice, closeComposer, names, type Props } from "./socialShared";
import { SocialSetupEditor } from "./SocialSetupEditor";
import { useSocialPending } from "./useSocialPending";
import "./social-programs.css";

/** A request from the program detail to load that program into the setup form. */
export type ProgramEditRequest = { program: SocialProgram; version: number };

/**
 * Guided setup/edit form for an AI campaign program. It owns every draft of the form (config,
 * wizard step, AI instructions, suggestion and schedule preview); the page owns saving results.
 */
export function ProgramSetupForm({
  client,
  snapshot,
  projects,
  initialProject,
  run,
  perform,
  hasPrograms,
  editRequest,
  onError,
}: Pick<Props, "client" | "snapshot" | "projects" | "initialProject" | "run"> & {
  perform: (action: string, input: Record<string, unknown>) => Promise<boolean>;
  hasPrograms: boolean;
  editRequest?: ProgramEditRequest;
  onError: (message: string) => void;
}) {
  const pendingUi = useSocialPending();
  const socialLocked = useContext(SocialBusyContext);
  const busy = socialLocked;
  const locale = useLocale();
  const formId = useId();
  const [setupStep, setSetupStep] = useState(0);
  const [features, setFeatures] = useState<ProgramFeatures>();
  const [config, setConfig] = useState<ProgramConfig>(() => defaultProgram(initialProject)),
    [edit, setEdit] = useState<SocialProgram>(),
    [instructions, setInstructions] = useState(""),
    [questions, setQuestions] = useState<string[]>([]),
    [preview, setPreview] = useState<number[]>([]);
  const [suggestion, setSuggestion] = useState<{ config: ProgramConfig; questions: string[]; base: string }>();
  const [appliedEdit, setAppliedEdit] = useState(0);
  // Loading a program into the form is a one-shot request identified by its version.
  if (editRequest && editRequest.version !== appliedEdit) {
    setAppliedEdit(editRequest.version);
    setConfig(programConfigFromProgram(editRequest.program));
    setEdit(editRequest.program);
  }
  const displayDate = (at: number) =>
    dateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: config.schedule.timeZone,
    }).format(at);
  const set = <K extends keyof ProgramConfig>(key: K, value: ProgramConfig[K]) => {
    setConfig((c) => ({
      ...c,
      [key]: value,
      ...(key === "accountIds"
        ? {
            mediaOverrides: Object.fromEntries(
              Object.entries(c.mediaOverrides ?? {}).filter(([id]) =>
                (value as string[]).includes(id),
              ),
            ),
          }
        : {}),
    }));
    setPreview([]);
  };
  const brief = (key: keyof ProgramConfig["brief"], value: string) =>
    set("brief", { ...config.brief, [key]: value });
  const schedule = <K extends keyof ProgramConfig["schedule"]>(
    key: K,
    value: ProgramConfig["schedule"][K],
  ) => set("schedule", { ...config.schedule, [key]: value });
  const purposeMissing = !config.name.trim() || !config.projectId || !config.brief.topic.trim() ||
    !config.brief.description.trim() || !config.accountIds.length ||
    config.accountIds.some((id) => !snapshot.accounts.find((account) => account.id === id)?.grants[config.projectId]?.includes("draft"));
  const scheduleMissing = !config.schedule.timeZone || !Number.isFinite(config.schedule.startsAt) || !config.schedule.days.length ||
    (config.schedule.mode === "times" && !config.schedule.times.length);
  const stepReason = setupStep === 0 && purposeMissing
    ? t("Complete the name, project, brief and eligible target accounts before continuing.")
    : setupStep === 1 && scheduleMissing ? t("Complete the time zone, start date, days and publishing times before continuing.") : "";
  const goToStep = (next: number) => {
    if (next > setupStep && (purposeMissing || (next > 1 && scheduleMissing))) {
      onError(purposeMissing ? t("Complete the name, project, brief and eligible target accounts before continuing.") : t("Complete the time zone, start date, days and publishing times before continuing."));
      return;
    }
    onError("");
    setSetupStep(next);
  };
  return (
    <SocialSetupEditor
      inline={!hasPrograms}
      title={edit ? t("Edit campaign program") : t("Generate from a brief")}
      editing={editRequest?.version ?? 0}
    >
      <form
        className="social-program-form"
        onInvalidCapture={(event) => {
          event.preventDefault();
          const invalid = event.currentTarget.querySelector<HTMLElement>(":invalid");
          const step = invalid?.closest<HTMLElement>("[data-program-step]");
          if (step) setSetupStep(Number(step.dataset.programStep));
          let parent = invalid?.parentElement;
          while (parent && parent !== event.currentTarget) {
            if (parent instanceof HTMLDetailsElement) parent.open = true;
            parent = parent.parentElement;
          }
          requestAnimationFrame(() => invalid?.focus());
        }}
        onSubmit={(e) => {
          e.preventDefault();
          if (!Number.isFinite(config.schedule.startsAt)) {
            // The shared date field does not block submit natively: send the owner back to the schedule step.
            setSetupStep(1);
            onError(t("Complete the time zone, start date, days and publishing times before continuing."));
            return;
          }
          const form = e.currentTarget;
          void pendingUi
            .run("programs.save-paused-campaign", () =>
              perform("programs.configure", {
                config,
                ...(edit ? { id: edit.id, expectedRevision: edit.revision } : {}),
              }),
            )
            .then((saved) => {
              if (saved) closeComposer(form);
            });
        }}
      >
        <nav className="social-program-steps" aria-label={t("Create AI campaign")}>
          {["Purpose and content", "Publishing schedule", "Approval and limits"].map(
            (label, index) => (
              <Button
                disabled={socialLocked}
                key={label}
                type="button"
                variant="tab"
                aria-current={setupStep === index ? "step" : undefined}
                aria-pressed={setupStep === index}
                onClick={() => goToStep(index)}
              >
                {t(label)}
              </Button>
            ),
          )}
        </nav>
        <div className="flex min-w-0 flex-wrap gap-x-4 gap-y-1 text-ui-caption text-(--ui-text-secondary)" aria-label={t("Content readiness")}>
          <span>{t("Text model")}: {config.textAgent?.model || t("Use project defaults")}</span>
          <span>{t("Media")}: {t(config.image.mode === "none" ? "No media" : config.image.mode === "generate" ? "Generate image" : "Existing media")}</span>
          <span>{features ? t("Model and platform availability loaded") : t("Availability has not been checked")}</span>
              <Button
                loading={pendingUi.is("programs.check-model-and-platform-availability")}
                disabled={socialLocked}
                variant="secondary"
                type="button"
                onClick={() =>
                  void pendingUi.run("programs.check-model-and-platform-availability", () =>
                    run(async () =>
                      setFeatures(await client.request<ProgramFeatures>("programs.features")),
                    ),
                  )
                }
              >
                {t("Check model and platform availability")}
              </Button>
        </div>
        {config.accountIds.length ? <ul className="m-0 flex min-w-0 list-none flex-col gap-2 p-0 text-ui-caption" aria-label={t("Account readiness")}>
          {config.accountIds.map((id) => {
            const account = snapshot.accounts.find((item) => item.id === id);
            const formats = features?.formats[id];
            const override = config.mediaOverrides?.[id];
            const generating = override === undefined && config.image.mode === "generate";
            const media = override ?? (config.image.mode === "existing" ? config.image.media : []);
            const requiredFormats = generating ? ["image"] : media.length ? [...new Set(media.map((item) => item.kind))] : ["text"];
            const unsupported = formats ? requiredFormats.filter((format) => !formats.formats.includes(format)) : [];
            const imageCapability = features?.images.filter((image) => config.image.provider === "automatic" || image.provider === config.image.provider);
            return <li key={id} className="min-w-0 break-words border-b border-(--ui-pane-border) pb-2">
              <strong className="font-medium">{account?.name ?? t("Removed account")}</strong> · {account ? names[account.platform] : ""}
              <p>{account?.grants[config.projectId]?.includes("draft") ? t("Draft access available") : t("Draft access to the selected project is required.")} · {account?.connected ? account.paused ? t("Account paused") : t("Connected") : t("Connect this account before publishing.")}</p>
              <p>{t("Supported formats")}: {formats ? formats.formats.join(", ") || t("No supported formats reported") : t("Unknown — check model and platform availability.")} {unsupported.length ? `${t("Selected media is not supported")}: ${unsupported.join(", ")}` : formats ? t("Selected media matches the reported formats.") : ""}</p>
              {formats?.reason ? <p>{formats.reason}</p> : null}
              {formats?.requiresReview ? <p>{t("Publication review is required for this account.")}</p> : null}
              {formats && !formats.allowsRepeat && config.strategy === "repeat" ? <p>{t("Repeated content is not allowed for this account.")}</p> : null}
              {generating ? <p>{t("Image generation")}: {imageCapability ? imageCapability.some((image) => image.available) ? t("Provider available; generated media still requires review.") : imageCapability.map((image) => image.reason).join(" · ") || t("No image provider is available.") : t("Unknown — check model and platform availability.")}</p> : <p>{t("Media")}: {media.length ? media.map((item) => item.kind).join(", ") : t("No media")}</p>}
              <p>{t("Text model availability is checked when generation starts. These format checks do not authorize publishing.")}</p>
            </li>;
          })}
        </ul> : null}
        <div className="social-program-step" data-program-step="0" hidden={setupStep !== 0}>
          <details className="social-program-advanced social-program-assistant">
            <summary>{t("Describe the campaign to AI")}</summary>
            <TextareaField
              disabled={socialLocked}
              label={t("Campaign instructions")}
              rows={3}
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
            />
            <Button
              variant="secondary"
              loading={pendingUi.is("programs.fill-settings-with-ai")}
              type="button"
              disabled={socialLocked || busy || !instructions.trim()}
              onClick={() =>
                void pendingUi.run("programs.fill-settings-with-ai", () =>
                  run(async () => {
                    const result = await client.request<{
                      config: ProgramConfig;
                      questions: string[];
                    }>("programs.suggest", { config, instructions });
                    setSuggestion({ config: result.config, questions: result.questions, base: JSON.stringify(config) });
                  }),
                )
              }
            >
              {t("Fill settings with AI")}
            </Button>
            {questions.map((q, i) => (
              <p key={i}>{q}</p>
            ))}
          </details>
          {suggestion ? <Notice kind="info" title={t("Review suggested settings")}>
            <p>{t("Your current brief is unchanged until you apply these settings.")}</p>
            <dl className="grid min-w-0 gap-2 text-ui-caption">
              {Object.keys(suggestion.config).filter((key) => JSON.stringify(suggestion.config[key as keyof ProgramConfig]) !== JSON.stringify(config[key as keyof ProgramConfig])).map((key) => (
                <div key={key} className="min-w-0"><dt className="font-medium">{t(PROGRAM_SUGGESTION_FIELD_LABELS[key] ?? key)}</dt>
                  <dd className="m-0 whitespace-pre-wrap break-words">{summarizeProgramSuggestion(key, suggestion.config, { locale, snapshot, projects })}<details className="mt-1"><summary>{t("Exact settings")}</summary><pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words">{JSON.stringify(suggestion.config[key as keyof ProgramConfig], null, 2)}</pre></details></dd>
                </div>
              ))}
            </dl>
            {suggestion.base !== JSON.stringify(config) ? <p>{t("Settings changed while the suggestion was prepared. Request a new suggestion to preserve your edits.")}</p> : null}
            <div className="social-actions"><Button disabled={socialLocked || suggestion.base !== JSON.stringify(config)} onClick={() => { setConfig(suggestion.config); setQuestions(suggestion.questions); setPreview([]); setSuggestion(undefined); }}>{t("Apply suggested settings")}</Button>
              <Button variant="ghost" onClick={() => setSuggestion(undefined)}>{t("Keep current settings")}</Button></div>
          </Notice> : null}
          <fieldset>
            <legend>{t("Purpose and content")}</legend>
            <div className="social-program-grid">
              <TextField
                disabled={socialLocked}
                label={t("Campaign name")}
                required
                value={config.name}
                onChange={(e) => set("name", e.target.value)}
              />
              <ProgramLabel text="Project">
                <NativeSearchableSelect
                  disabled={socialLocked}
                  label={t("Project")}
                  options={[
                    { value: "", label: t("Select project") },
                    ...projects.map((p) => ({ value: p.id, label: p.name })),
                  ]}
                  required
                  value={config.projectId}
                  onChange={(e) =>
                    setConfig((c) => ({
                      ...c,
                      projectId: e.target.value,
                      brief: {
                        ...c.brief,
                        voice:
                          snapshot.profiles.find((p) => p.projectId === e.target.value)
                            ?.brandVoice ?? c.brief.voice,
                        factIds: [],
                      },
                    }))
                  }
                />
              </ProgramLabel>
              <TextField
                disabled={socialLocked}
                label={t("Topic")}
                required
                value={config.brief.topic}
                onChange={(e) => brief("topic", e.target.value)}
              />
            </div>
            <TextareaField
              disabled={socialLocked}
              label={t("Description")}
              required
              rows={3}
              value={config.brief.description}
              onChange={(e) => brief("description", e.target.value)}
            />
            <SocialMultiSelect
              label={t("Target accounts")}
              selected={config.accountIds}
              onChange={(ids) => set("accountIds", ids)}
              options={snapshot.accounts.map((a) => ({
                value: a.id,
                label: `${names[a.platform]} · ${a.name}`,
                description: !config.projectId ? t("Select a project first.") : !a.grants[config.projectId]?.includes("draft") ? t("Draft access to the selected project is required.") : !a.connected ? t("Content can be prepared; connect this account before publishing.") : undefined,
                disabled: !a.grants[config.projectId]?.includes("draft"),
              }))}
            />
            <details className="social-program-advanced social-program-content-options">
              <summary>{t("Brand and content details")}</summary>
              <TextField
                disabled={socialLocked}
                label={t("Title")}
                value={config.brief.title}
                onChange={(e) => brief("title", e.target.value)}
              />
              <div className="social-program-grid">
                <TextField
                  disabled={socialLocked}
                  label={t("Audience")}
                  value={config.brief.audience}
                  onChange={(e) => brief("audience", e.target.value)}
                />
                <TextField
                  disabled={socialLocked}
                  label={t("Content language")}
                  value={config.brief.language}
                  onChange={(e) => brief("language", e.target.value)}
                />
                <TextField
                  disabled={socialLocked}
                  label={t("Brand voice")}
                  value={config.brief.voice}
                  onChange={(e) => brief("voice", e.target.value)}
                />
                <TextField
                  disabled={socialLocked}
                  label={t("Call to action")}
                  value={config.brief.cta}
                  onChange={(e) => brief("cta", e.target.value)}
                />
                <TextField
                  disabled={socialLocked}
                  label={t("Content angles (comma separated)")}
                  value={config.brief.angles?.join(", ") ?? ""}
                  onChange={(e) =>
                    set("brief", {
                      ...config.brief,
                      angles: e.target.value
                        .split(",")
                        .map((s) => s.trim())
                        .filter(Boolean),
                    })
                  }
                />
                <TextField
                  disabled={socialLocked}
                  label={t("Public link")}
                  type="url"
                  value={config.brief.link ?? ""}
                  onChange={(e) => brief("link", e.target.value)}
                />
              </div>
              <ProgramLabel text="Content template">
                <NativeSelect
                  disabled={socialLocked}
                  defaultValue=""
                  onChange={(e) => {
                    if (e.target.value)
                      set("brief", {
                        ...config.brief,
                        angles:
                          e.target.value === "workflow"
                            ? ["problem", "steps", "example", "tip"]
                            : ["benefit", "feature", "example", "announcement"],
                      });
                  }}
                >
                  <option value="">{t("Custom brief")}</option>
                  <option value="workflow">{t("Workflow and tips")}</option>
                  <option value="launch">{t("Product launch")}</option>
                </NativeSelect>
              </ProgramLabel>
              <Button
                variant="secondary"
                type="button"
                disabled={socialLocked || !config.brief.link}
                onClick={() => {
                  try {
                    const u = new URL(config.brief.link!);
                    u.searchParams.set("utm_source", "social");
                    u.searchParams.set("utm_medium", "campaign");
                    u.searchParams.set("utm_campaign", config.name);
                    brief("link", u.href);
                  } catch {
                    onError(t("Enter a valid public link."));
                  }
                }}
              >
                {t("Add campaign UTM tags")}
              </Button>
              <SocialMultiSelect
                label={t("Verified public facts")}
                selected={config.brief.factIds}
                onChange={(ids) => set("brief", { ...config.brief, factIds: ids })}
                options={snapshot.profiles
                  .filter((p) => p.projectId === config.projectId)
                  .flatMap((p) =>
                    p.facts.map((f) => ({ value: f.id, label: f.topic, description: f.text })),
                  )}
              />


              {features ? (
                <ul>
                  {config.accountIds.map((id) => (
                    <li key={id}>
                      {snapshot.accounts.find((a) => a.id === id)?.name}:{" "}
                      {features.formats[id]?.formats.join(", ")} {features.formats[id]?.reason}
                    </li>
                  ))}
                </ul>
              ) : null}
            </details>
          </fieldset>
          <details className="social-program-advanced">
            <summary>{t("AI models and media")}</summary>
            <fieldset>
              <legend className="sr-only">{t("AI models and media")}</legend>
              <div className="social-program-grid">
                <SocialModelField
                  label={t("Text agent and model")}
                  inheritLabel={t("Use the global agent")}
                  disabled={socialLocked}
                  value={{
                    provider: config.textAgent?.provider ?? "",
                    model: config.textAgent?.model ?? "",
                  }}
                  onChange={(next) =>
                    set(
                      "textAgent",
                      next.provider
                        ? {
                            provider: next.provider as NonNullable<
                              ProgramConfig["textAgent"]
                            >["provider"],
                            ...(next.model ? { model: next.model } : {}),
                          }
                        : undefined,
                    )
                  }
                />
                <ProgramLabel text="Media source">
                  <NativeSelect
                    disabled={socialLocked}
                    value={config.image.mode}
                    onChange={(e) =>
                      set("image", {
                        ...config.image,
                        mode: e.target.value as ProgramConfig["image"]["mode"],
                      })
                    }
                  >
                    <option value="none">{t("No image")}</option>
                    <option value="existing">{t("Existing media")}</option>
                    <option value="generate" disabled={config.strategy === "pool"}>
                      {t("Generate image")}
                    </option>
                  </NativeSelect>
                </ProgramLabel>
                {config.image.mode === "generate" ? (
                  <>
                    <ProgramLabel text="Image provider">
                      <NativeSelect
                        disabled={socialLocked}
                        value={config.image.provider}
                        onChange={(e) =>
                          set("image", {
                            ...config.image,
                            provider: e.target.value as ProgramConfig["image"]["provider"],
                            model: undefined,
                          })
                        }
                      >
                        <option value="automatic">
                          {t("Automatic: Codex → Gemini → ComfyUI")}
                        </option>
                        {["codex", "gemini", "comfyui", "openai-api"].map((id) => (
                          <option
                            key={id}
                            value={id}
                            disabled={
                              features
                                ? !features.images.find((i) => i.provider === id)?.available
                                : false
                            }
                          >
                            {id === "openai-api" ? t("OpenAI API (separately billed)") : id}
                          </option>
                        ))}
                      </NativeSelect>
                    </ProgramLabel>
                    <div className="social-program-field">
                      <TextField
                        label={t("Image model")}
                        disabled={socialLocked || config.image.provider === "automatic"}
                        value={config.image.model ?? ""}
                        list={`${formId}-image-models`}
                        onChange={(e) => set("image", { ...config.image, model: e.target.value })}
                      />
                      <datalist id={`${formId}-image-models`}>
                        {features?.images
                          .find((i) => i.provider === config.image.provider)
                          ?.models.map((m) => (
                            <option key={m} value={m} />
                          ))}
                      </datalist>
                    </div>
                    <ProgramLabel text="Aspect ratio">
                      <NativeSelect
                        disabled={socialLocked}
                        value={config.image.aspectRatio}
                        onChange={(e) =>
                          set("image", {
                            ...config.image,
                            aspectRatio: e.target.value as ProgramConfig["image"]["aspectRatio"],
                          })
                        }
                      >
                        {["1:1", "4:5", "16:9"].map((x) => (
                          <option
                            key={x}
                            disabled={config.image.provider === "openai-api" && x !== "1:1"}
                          >
                            {x}
                          </option>
                        ))}
                      </NativeSelect>
                    </ProgramLabel>
                    {features?.images.map((i) => (
                      <p key={i.provider}>
                        {i.provider}: {i.available ? t("Available") : t("Unavailable")} {i.reason}
                      </p>
                    ))}
                  </>
                ) : null}
                {config.image.mode === "existing" ? (
                  <>
                    <ProgramLabel text="Media library">
                      <SearchableSelect
                        disabled={socialLocked}
                        value=""
                        label={t("Media library")}
                        options={[
                          { value: "", label: t("Select saved media") },
                          ...[
                            ...new Map(
                              snapshot.campaigns
                                .flatMap((c) => c.variants)
                                .flatMap((v) => v.media)
                                .map((m) => [m.uploadId ?? m.url, m]),
                            ).values(),
                          ].map((m, i) => ({
                            value: m.uploadId ?? m.url ?? "",
                            label: m.alt || `${m.kind} ${i + 1}`,
                          })),
                        ]}
                        onChange={(nextValue) => {
                          const media = snapshot.campaigns
                            .flatMap((c) => c.variants)
                            .flatMap((v) => v.media)
                            .find((m) => (m.uploadId ?? m.url) === nextValue);
                          if (media) set("image", { ...config.image, media: [media] });
                        }}
                        searchLocale={getLocale()}
                      />
                    </ProgramLabel>
                    <TextField
                      disabled={socialLocked}
                      label={t("Upload image or video")}
                      type="file"
                      accept="image/png,image/jpeg,video/mp4,video/webm"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file)
                          void pendingUi.run("program.upload-media", () =>
                            run(async () => {
                              const asset = file.type.startsWith("video/")
                                ? await client.uploadVideo(file)
                                : await client.upload(file);
                              set("image", {
                                ...config.image,
                                media: [
                                  {
                                    kind: file.type.startsWith("video/") ? "video" : "image",
                                    uploadId: asset.uploadId,
                                  },
                                ],
                              });
                            }),
                          );
                      }}
                    />
                    {pendingUi.is("program.upload-media") ? (
                      <Progress label={t("Operation in progress…")} />
                    ) : null}
                    <TextField
                      disabled={socialLocked}
                      label={t("Public image URL")}
                      type="url"
                      value={config.image.media[0]?.url ?? ""}
                      onChange={(e) =>
                        set("image", {
                          ...config.image,
                          media: e.target.value ? [{ kind: "image", url: e.target.value }] : [],
                        })
                      }
                    />
                    <p>{config.image.media[0]?.uploadId ? t("Media uploaded") : ""}</p>
                  </>
                ) : null}
              </div>
              <ProgramLabel text="Content strategy">
                <SearchableSelect
                  disabled={socialLocked}
                  value={config.strategy}
                  searchable={false}
                  label={t("Content strategy")}
                  options={[
                    { value: "unique", label: t("Unique content for every post") },
                    {
                      value: "repeat",
                      label: t("Repeat approved content"),
                      disabled: config.accountIds.some(
                        (id) => snapshot.accounts.find((a) => a.id === id)?.platform === "x",
                      ),
                    },
                    {
                      value: "pool",
                      label: t("Rotate approved content pool"),
                      disabled: config.accountIds.some(
                        (id) => snapshot.accounts.find((a) => a.id === id)?.platform === "x",
                      ),
                    },
                  ]}
                  onChange={(nextValue) =>
                    set("strategy", nextValue as ProgramConfig["strategy"])
                  }
                  searchLocale={getLocale()}
                />
              </ProgramLabel>
              <details>
                <summary>{t("Account-specific media")}</summary>
                {config.accountIds.map((id) => (
                  <section key={id}>
                    <strong>{snapshot.accounts.find((a) => a.id === id)?.name}</strong>
                    <TextField
                      disabled={socialLocked}
                      label={t("Override media")}
                      type="file"
                      accept="image/png,image/jpeg,video/mp4,video/webm"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file)
                          void pendingUi.run(`program.upload-override:${id}`, () =>
                            run(async () => {
                              const asset = file.type.startsWith("video/")
                                ? await client.uploadVideo(file)
                                : await client.upload(file);
                              setConfig((c) => ({
                                ...c,
                                mediaOverrides: {
                                  ...c.mediaOverrides,
                                  [id]: [
                                    {
                                      kind: file.type.startsWith("video/") ? "video" : "image",
                                      uploadId: asset.uploadId,
                                    },
                                  ],
                                },
                              }));
                            }),
                          );
                      }}
                    />
                    {pendingUi.is(`program.upload-override:${id}`) ? (
                      <Progress label={t("Operation in progress…")} />
                    ) : null}
                    <ProgramLabel text="Use text only">
                      <Checkbox
                        disabled={socialLocked}
                        checked={config.mediaOverrides?.[id]?.length === 0}
                        onChange={(e) =>
                          setConfig((c) => {
                            const overrides = { ...c.mediaOverrides };
                            if (e.target.checked) overrides[id] = [];
                            else delete overrides[id];
                            return { ...c, mediaOverrides: overrides };
                          })
                        }
                      />
                    </ProgramLabel>
                    {config.mediaOverrides?.[id]?.length ? (
                      <p>
                        {t("Media override saved")}
                        <Button
                          disabled={socialLocked}
                          variant="secondary"
                          type="button"
                          onClick={() =>
                            setConfig((c) => {
                              const overrides = { ...c.mediaOverrides };
                              delete overrides[id];
                              return { ...c, mediaOverrides: overrides };
                            })
                          }
                        >
                          {t("Use campaign media")}
                        </Button>
                      </p>
                    ) : null}
                  </section>
                ))}
              </details>
              {config.strategy === "pool" ? (
                <SocialMultiSelect
                  label={t("Approved content pool")}
                  selected={config.poolCampaignIds}
                  onChange={(ids) => set("poolCampaignIds", ids)}
                  options={snapshot.campaigns
                    .filter((c) => snapshot.approvedCampaignIds?.includes(c.id))
                    .map((c) => ({ value: c.id, label: c.name }))}
                />
              ) : null}
              {config.accountIds.some(
                (id) => snapshot.accounts.find((a) => a.id === id)?.platform === "youtube",
              ) ? (
                <div className="social-program-grid">
                  <TextField
                    disabled={socialLocked}
                    label={t("Video title")}
                    value={config.youtube?.title ?? ""}
                    onChange={(e) =>
                      set("youtube", {
                        privacy: "private",
                        madeForKids: false,
                        containsSyntheticMedia: false,
                        ...config.youtube,
                        title: e.target.value,
                      })
                    }
                  />
                  <ProgramLabel text="Video visibility">
                    <NativeSelect
                      disabled={socialLocked}
                      value={config.youtube?.privacy ?? "private"}
                      onChange={(e) =>
                        set("youtube", {
                          title: config.brief.title,
                          madeForKids: false,
                          containsSyntheticMedia: false,
                          ...config.youtube,
                          privacy: e.target.value as "private" | "unlisted" | "public",
                        })
                      }
                    >
                      {["private", "unlisted", "public"].map((v) => (
                        <option key={v}>{v}</option>
                      ))}
                    </NativeSelect>
                  </ProgramLabel>
                  <ProgramLabel text="Made for kids">
                    <Checkbox
                      disabled={socialLocked}
                      checked={config.youtube?.madeForKids ?? false}
                      onChange={(e) =>
                        set("youtube", {
                          title: config.brief.title,
                          privacy: "private",
                          containsSyntheticMedia: false,
                          ...config.youtube,
                          madeForKids: e.target.checked,
                        })
                      }
                    />
                  </ProgramLabel>
                  <ProgramLabel text="Contains synthetic media">
                    <Checkbox
                      disabled={socialLocked}
                      checked={config.youtube?.containsSyntheticMedia ?? false}
                      onChange={(e) =>
                        set("youtube", {
                          title: config.brief.title,
                          privacy: "private",
                          madeForKids: false,
                          ...config.youtube,
                          containsSyntheticMedia: e.target.checked,
                        })
                      }
                    />
                  </ProgramLabel>
                </div>
              ) : null}
            </fieldset>
          </details>
        </div>
        <div className="social-program-step" data-program-step="1" hidden={setupStep !== 1}>
          <fieldset>
            <legend>{t("Publishing schedule")}</legend>
            <div className="social-program-grid">
              <RadioGroup
                disabled={socialLocked}
                compact
                label={t("Schedule mode")}
                options={[
                  { value: "times", label: t("Specific times") },
                  { value: "interval", label: t("Intervals") },
                  { value: "frequency", label: t("Posting frequency") },
                ]}
                value={config.schedule.mode}
                onChange={(e) =>
                  schedule("mode", e.target.value as ProgramConfig["schedule"]["mode"])
                }
              />
              <TextField
                disabled={socialLocked}
                label={t("Time zone")}
                required
                value={config.schedule.timeZone}
                onChange={(e) => schedule("timeZone", e.target.value)}
              />
              <DateTimeField
                disabled={socialLocked}
                label={t("Campaign start (device local time)")}
                required
                value={Number.isFinite(config.schedule.startsAt) ? localDateTimeInput(config.schedule.startsAt) : ""}
                onChange={(next) => schedule("startsAt", next ? new Date(next).getTime() : Number.NaN)}
              />
              <DateTimeField
                disabled={socialLocked}
                label={t("Campaign end (optional)")}
                clearable
                value={config.schedule.endsAt ? localDateTimeInput(config.schedule.endsAt) : ""}
                onChange={(next) => schedule("endsAt", next ? new Date(next).getTime() : undefined)}
              />
              <NumberField
                label={t("Total logical posts")}
                min={1}
                max={10000}
                disabled={socialLocked || config.totalPosts === null}
                value={config.totalPosts ?? ""}
                onChange={(e) => set("totalPosts", Number(e.target.value))}
              />
              <ProgramLabel text="Continuous campaign">
                <Checkbox
                  disabled={socialLocked}
                  checked={config.totalPosts === null}
                  onChange={(e) => set("totalPosts", e.target.checked ? null : 10)}
                />
              </ProgramLabel>
              {config.schedule.mode === "times" ? (
                <TextField
                  disabled={socialLocked}
                  label={t("Publishing times (HH:mm, comma separated)")}
                  required
                  value={config.schedule.times.join(", ")}
                  onChange={(e) =>
                    schedule(
                      "times",
                      e.target.value.split(",").map((x) => x.trim()),
                    )
                  }
                />
              ) : (
                <>
                  <DateTimeField
                    mode="time"
                    disabled={socialLocked}
                    label={t("Window start")}
                    value={config.schedule.startTime}
                    onChange={(next) => schedule("startTime", next)}
                  />
                  <DateTimeField
                    mode="time"
                    disabled={socialLocked}
                    label={t("Window end")}
                    value={config.schedule.endTime}
                    onChange={(next) => schedule("endTime", next)}
                  />
                  {config.schedule.mode === "interval" ? (
                    <>
                      <NumberField
                        disabled={socialLocked}
                        label={t("Minimum interval (minutes)")}
                        min={1}
                        value={config.schedule.minIntervalMinutes}
                        onChange={(e) => schedule("minIntervalMinutes", Number(e.target.value))}
                      />
                      <NumberField
                        disabled={socialLocked}
                        label={t("Maximum interval (minutes)")}
                        min={1}
                        value={config.schedule.maxIntervalMinutes}
                        onChange={(e) => schedule("maxIntervalMinutes", Number(e.target.value))}
                      />
                    </>
                  ) : (
                    <>
                      <NumberField
                        disabled={socialLocked}
                        label={t("Posts per period")}
                        min={1}
                        max={48}
                        value={config.schedule.frequency}
                        onChange={(e) => schedule("frequency", Number(e.target.value))}
                      />
                      <ProgramLabel text="Period">
                        <NativeSelect
                          disabled={socialLocked}
                          value={config.schedule.period}
                          onChange={(e) => schedule("period", e.target.value as "day" | "week")}
                        >
                          <option value="day">{t("Day")}</option>
                          <option value="week">{t("Week")}</option>
                        </NativeSelect>
                      </ProgramLabel>
                    </>
                  )}
                </>
              )}
            </div>
            <div className="social-program-days">
              {[1, 2, 3, 4, 5, 6, 7].map((day) => (
                <label key={day}>
                  <Checkbox
                    disabled={socialLocked}
                    checked={config.schedule.days.includes(day)}
                    onChange={(e) =>
                      schedule(
                        "days",
                        e.target.checked
                          ? [...config.schedule.days, day]
                          : config.schedule.days.filter((d) => d !== day),
                      )
                    }
                  />
                  {dateTimeFormat(locale, { weekday: "short" }).format(
                    new Date(Date.UTC(2026, 0, 4 + day, 12)),
                  )}
                </label>
              ))}
            </div>
            <p>
              {t("{posts} logical posts × {accounts} accounts", {
                posts: config.totalPosts ?? "∞",
                accounts: config.accountIds.length,
              })}
            </p>
            <Button
              loading={pendingUi.is("programs.preview-publishing-times")}
              disabled={socialLocked}
              variant="secondary"
              type="button"
              onClick={() =>
                void pendingUi.run("programs.preview-publishing-times", () =>
                  run(async () => {
                    const result = await client.request<{ dates: number[] }>(
                      "programs.preview-schedule",
                      { config },
                    );
                    setPreview(result.dates);
                  }),
                )
              }
            >
              {t("Preview publishing times")}
            </Button>
            {preview.length ? (
              <ol>
                {preview.map((at) => (
                  <li key={at}>{displayDate(at)}</li>
                ))}
              </ol>
            ) : null}
          </fieldset>
        </div>
        <div className="social-program-step" data-program-step="2" hidden={setupStep !== 2}>
          <dl className="social-program-review">
            <div>
              <dt>{t("Campaign name")}</dt>
              <dd>{config.name || "—"}</dd>
            </div>
            <div>
              <dt>{t("Target accounts")}</dt>
              <dd>
                {config.accountIds
                  .map((id) => snapshot.accounts.find((account) => account.id === id)?.name ?? id)
                  .join(", ") || "—"}
              </dd>
            </div>
            <div>
              <dt>{t("Topic")}</dt>
              <dd>{config.brief.topic || "—"}</dd>
            </div>
            <div>
              <dt>{t("Publishing schedule")}</dt>
              <dd>
                {config.schedule.timeZone} ·{" "}
                {t(
                  config.schedule.mode === "times"
                    ? "Specific times"
                    : config.schedule.mode === "interval"
                      ? "Intervals"
                      : "Posting frequency",
                )}
              </dd>
            </div>
          </dl>
          <fieldset>
            <legend>{t("Approval and limits")}</legend>
            <RadioGroup
              disabled={socialLocked}
              label={t("Approval mode")}
              options={(
                [
                  ["approved", "Approved"],
                  ["semi", "Semi-approved: first sample and plan"],
                  ["automatic", "Automatic"],
                ] as const
              ).map(([mode, label]) => ({
                value: mode,
                label: t(label),
                description: programApprovalSteps(mode).length
                  ? programApprovalSteps(mode)
                      .map((step) => t(PROGRAM_STEP_LABELS[step]))
                      .join(" · ")
                  : t("Automatic after explicit activation"),
              }))}
              value={config.approval.mode}
              onChange={(e) => {
                const mode = e.target.value as ProgramConfig["approval"]["mode"];
                set("approval", { mode, steps: programApprovalSteps(mode) });
              }}
            />
            <div className="social-program-days">
              {PROGRAM_STEPS.map((step) => (
                <label key={step}>
                  <Checkbox
                    disabled={socialLocked}
                    checked={config.approval.steps.includes(step)}
                    onChange={(e) =>
                      set("approval", {
                        ...config.approval,
                        steps: e.target.checked
                          ? [...config.approval.steps, step]
                          : config.approval.steps.filter((s) => s !== step),
                      })
                    }
                  />
                  {t(PROGRAM_STEP_LABELS[step])}
                </label>
              ))}
            </div>
            <p>
              {t(
                "Semi-approved mode checks the first sample. Final publication, when selected, is checked for every post. LinkedIn always requires publication review.",
              )}
            </p>
            <details className="social-program-advanced">
              <summary>{t("Generation usage")}</summary>
              <div className="social-program-grid">
                {(
                  [
                    "dailyPosts",
                    "dailyGenerations",
                    "totalGenerations",
                    "maxImageGenerations",
                  ] as const
                ).map((key) => (
                  <NumberField
                    disabled={socialLocked}
                    key={key}
                    label={t(
                      {
                        dailyPosts: "Daily posts per account",
                        dailyGenerations: "Daily generation budget",
                        totalGenerations: "Total generation budget",
                        maxImageGenerations: "Image generation budget",
                      }[key],
                    )}
                    min={1}
                    max={100000}
                    value={config.limits[key]}
                    onChange={(e) =>
                      set("limits", { ...config.limits, [key]: Number(e.target.value) })
                    }
                  />
                ))}
              </div>
              <p>
                {t(
                  "Generation counts are hard limits. Unknown provider costs are not shown as zero.",
                )}
              </p>
            </details>
          </fieldset>
        </div>
        <footer className="social-program-setup-actions">
          {stepReason ? <p role="status" className="w-full text-ui-caption text-(--ui-text-secondary)">{stepReason}</p> : null}
          {setupStep > 0 ? (
            <Button
              disabled={socialLocked}
              variant="secondary"
              type="button"
              onClick={() => setSetupStep((step) => step - 1)}
            >
              {t("Back")}
            </Button>
          ) : null}
          {setupStep < 2 ? (
            <Button
              disabled={socialLocked || !!stepReason}
              variant="primary"
              type="button"
              onClick={() => goToStep(setupStep + 1)}
            >
              {t("Continue")}
            </Button>
          ) : null}
          <Button
            variant="primary"
            loading={pendingUi.is("programs.save-paused-campaign")}
            type="submit"
            disabled={socialLocked || busy}
            hidden={setupStep !== 2}
          >
            {t("Save paused campaign")}
          </Button>
          {edit ? (
            <Button
              disabled={socialLocked}
              variant="secondary"
              type="button"
              onClick={() => {
                setEdit(undefined);
                setConfig(defaultProgram(initialProject));
              }}
            >
              {t("New campaign")}
            </Button>
          ) : null}
        </footer>
      </form>
    </SocialSetupEditor>
  );
}
