import { Progress } from "../../../shared/ui/Progress";
import { useSocialPending } from "./useSocialPending";
import { useContext as useSocialContext } from "react";
import { SocialBusyContext as SocialLockContext } from "./socialContext";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { TextField } from "../../../shared/ui/TextField";
import { NativeSelect } from "../../../shared/ui/Select";
import { NativeSearchableSelect } from "../../../shared/ui/NativeSearchableSelect";
import { RadioGroup } from "../../../shared/ui/RadioGroup";
import { TextareaField } from "../../../shared/ui/TextareaField";
import { Badge } from "../../../shared/ui/Badge";
import { Button } from "../../../shared/ui/Button";
import { ConfirmMorph } from "../../../shared/ui/ConfirmMorph";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { dateTimeFormat } from "../../../shared/lib/intl";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useQueryVisible } from "../../../shared/hooks/useQueryVisible";
import { socialQueryScope } from "../model/socialQuery";
import {
  Children,
  cloneElement,
  isValidElement,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { getLocale, t, useLocale } from "../../../shared/i18n";
import { REMOTE_PROVIDERS } from "../../connections/model/protocol";
import { modelsFor } from "../../sessions/model/models";
import {
  defaultProgram,
  programApprovalSteps,
  PROGRAM_STEPS,
  type ProgramConfig,
  type ProgramDetail,
  type ProgramFeatures,
  type SocialProgram,
  type ProgramTarget,
  type SocialOccurrence,
} from "../model/socialProgram";
import type { CampaignVariant } from "../model/social";
import { SocialMultiSelect } from "./SocialMultiSelect";
import { SocialPanelActiveContext, SocialBusyContext } from "./socialContext";
import { Notice, closeComposer, names, type Props } from "./socialShared";
import "./social-programs.css";
import { SocialSetupEditor } from "./SocialSetupEditor";

const steps: Record<string, string> = {
  text: "Text",
  image: "Image",
  adaptation: "Platform adaptation",
  schedule: "Schedule",
  publish: "Final publication",
};
const states: Record<string, string> = {
  pending: "Pending",
  generating: "Generating",
  review: "Review required",
  ready: "Ready",
  queued: "Queued",
  succeeded: "Published",
  failed: "Failed",
  cancelled: "Cancelled",
};
/** Connect domain field labels to native inputs and shared adapters alike. */
function Label({ text, children }: { text: string; children: ReactNode }) {
  const generatedId = useId();
  const firstControl = Children.toArray(children).find(
    (child) =>
      isValidElement<Record<string, unknown>>(child) &&
      [
        TextField,
        TextareaField,
        NativeSelect,
        NativeSearchableSelect,
        Checkbox,
        SearchableSelect,
      ].includes(child.type as typeof TextField),
  );
  const id =
    isValidElement<Record<string, unknown>>(firstControl) &&
    typeof firstControl.props.id === "string"
      ? firstControl.props.id
      : generatedId;
  return (
    <div className="social-program-field">
      <label id={`${id}-label`} htmlFor={id}>
        {t(text)}
      </label>
      {Children.map(children, (child) => {
        if (!isValidElement<Record<string, unknown>>(child)) return child;
        if (child.type === SearchableSelect) {
          const triggerProps = (child.props.triggerProps ?? {}) as Record<string, unknown>;
          return cloneElement(child, {
            triggerProps: {
              ...triggerProps,
              id,
              "aria-labelledby": [triggerProps["aria-labelledby"], `${id}-label`]
                .filter(Boolean)
                .join(" "),
            },
          });
        }
        if (
          ![
            TextField,
            TextareaField,
            NativeSelect,
            NativeSearchableSelect,
            Checkbox,
            "input",
            "select",
            "textarea",
          ].includes(child.type as typeof TextField)
        )
          return child;
        const controlId = child.props.id ?? id;
        return cloneElement(child, {
          id: controlId,
          "aria-labelledby": [child.props["aria-labelledby"], `${id}-label`]
            .filter(Boolean)
            .join(" "),
        });
      })}
    </div>
  );
}

const localInput = (at: number) => {
  const d = new Date(at);
  return new Date(at - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

export function SocialPrograms({ client, snapshot, projects, initialProject, run }: Props) {
  const pendingUi = useSocialPending();
  const socialLocked = useSocialContext(SocialLockContext);
  const [setupStep, setSetupStep] = useState(0);
  const locale = useLocale(),
    active = useContext(SocialPanelActiveContext),
    busy = useContext(SocialBusyContext);
  const formId = useId();
  const [features, setFeatures] = useState<ProgramFeatures>();
  const [config, setConfig] = useState<ProgramConfig>(() => defaultProgram(initialProject)),
    [edit, setEdit] = useState<SocialProgram>(),
    [instructions, setInstructions] = useState(""),
    [questions, setQuestions] = useState<string[]>([]),
    [preview, setPreview] = useState<number[]>([]),
    [error, setError] = useState(""),
    [confirmed, setConfirmed] = useState(false);
  const [bulkLink, setBulkLink] = useState("");
  const [editVersion, setEditVersion] = useState(0);
  const displayDate = (at: number) =>
    dateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: config.schedule.timeZone,
    }).format(at);
  const queryClient = useQueryClient();
  const visible = useQueryVisible();
  const scope = socialQueryScope(client);
  const projectId = snapshot.programProjectId;
  const [selectedProgram, setSelectedProgram] = useState<string>();
  const listKey = [...scope, "programs", projectId ?? ""];
  const detailKey = [...scope, "program", selectedProgram ?? ""];
  const enabled = !!snapshot.programsSupported && active && visible;
  const listQuery = useQuery({
    queryKey: listKey,
    queryFn: () => client.request<SocialProgram[]>("programs.list", projectId ? { projectId } : {}),
    enabled,
    staleTime: 5_000,
    refetchInterval: 5_000,
  });
  const detailQuery = useQuery({
    queryKey: detailKey,
    queryFn: () => client.request<ProgramDetail>("programs.status", { id: selectedProgram }),
    enabled: enabled && !!selectedProgram,
    staleTime: 5_000,
    refetchInterval: 5_000,
  });
  const programs = listQuery.data ?? [];
  const detail = detailQuery.data;
  useEffect(() => {
    if (!selectedProgram && programs.length) setSelectedProgram(programs[0].id);
  }, [programs, selectedProgram]);
  function setDetail(
    value: ProgramDetail | undefined | ((previous: ProgramDetail | undefined) => ProgramDetail),
  ) {
    const next = typeof value === "function" ? value(detail) : value;
    setSelectedProgram(next?.program.id);
    if (next) queryClient.setQueryData([...scope, "program", next.program.id], next);
  }
  const setPrograms = (list: SocialProgram[]) => queryClient.setQueryData(listKey, list);
  const refreshError = listQuery.error ?? detailQuery.error;
  useEffect(() => {
    if (detail && projectId && detail.program.projectId !== projectId)
      setSelectedProgram(undefined);
  }, [projectId, detail]);
  useEffect(
    () => setConfirmed(false),
    [detail?.program.id, detail?.program.revision, detail?.program.enabled, detail?.program.reason],
  );
  const perform = async (action: string, input: Record<string, unknown>) => {
    return run(async () => {
      const result = await client.request<ProgramDetail | SocialProgram>(action, input);
      if (result && "program" in result) setDetail(result);
      else if (result && "id" in result) {
        const fresh = await client.request<ProgramDetail>("programs.status", { id: result.id });
        setDetail(fresh);
      }
      const list = await client.request<SocialProgram[]>(
        "programs.list",
        snapshot.programProjectId ? { projectId: snapshot.programProjectId } : {},
      );
      setPrograms(list);
    });
  };
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
  if (!snapshot.programsSupported) return null;
  return (
    <section className="social-programs" aria-label={t("AI campaign programs")}>
      {error || refreshError ? <Notice kind="error">{error || String(refreshError)}</Notice> : null}
      <SocialSetupEditor
        inline={!programs.length}
        title={edit ? t("Edit campaign program") : t("Create AI campaign")}
        editing={editVersion}
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
                  onClick={() => setSetupStep(index)}
                >
                  {t(label)}
                </Button>
              ),
            )}
          </nav>
          <div className="social-program-step" data-program-step="0" hidden={setupStep !== 0}>
            <details className="social-program-advanced social-program-assistant" open>
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
                      setConfig(result.config);
                      setQuestions(result.questions);
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
                <Label text="Project">
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
                </Label>
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
                <Label text="Content template">
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
                </Label>
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
                      setError(t("Enter a valid public link."));
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
                  <Label text="Text provider">
                    <NativeSelect
                      disabled={socialLocked}
                      value={config.textAgent?.provider ?? ""}
                      onChange={(e) =>
                        set(
                          "textAgent",
                          e.target.value
                            ? {
                                provider: e.target.value as NonNullable<
                                  ProgramConfig["textAgent"]
                                >["provider"],
                              }
                            : undefined,
                        )
                      }
                    >
                      <option value="">{t("Effective account policy")}</option>
                      {REMOTE_PROVIDERS.map((id) => (
                        <option key={id} value={id}>
                          {id}
                        </option>
                      ))}
                    </NativeSelect>
                  </Label>
                  <div className="social-program-field">
                    <TextField
                      label={t("Text model")}
                      list={`${formId}-models`}
                      value={config.textAgent?.model ?? ""}
                      disabled={socialLocked || !config.textAgent}
                      onChange={(e) =>
                        config.textAgent &&
                        set("textAgent", { ...config.textAgent, model: e.target.value })
                      }
                    />
                    <datalist id={`${formId}-models`}>
                      {config.textAgent
                        ? modelsFor(config.textAgent.provider).map((m) => (
                            <option key={m.id} value={m.nativeId ?? m.id}>
                              {m.name}
                            </option>
                          ))
                        : null}
                    </datalist>
                  </div>
                  <Label text="Media source">
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
                  </Label>
                  {config.image.mode === "generate" ? (
                    <>
                      <Label text="Image provider">
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
                      </Label>
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
                      <Label text="Aspect ratio">
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
                      </Label>
                      {features?.images.map((i) => (
                        <p key={i.provider}>
                          {i.provider}: {i.available ? t("Available") : t("Unavailable")} {i.reason}
                        </p>
                      ))}
                    </>
                  ) : null}
                  {config.image.mode === "existing" ? (
                    <>
                      <Label text="Media library">
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
                      </Label>
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
                <Label text="Content strategy">
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
                </Label>
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
                      <Label text="Use text only">
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
                      </Label>
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
                    <Label text="Video visibility">
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
                    </Label>
                    <Label text="Made for kids">
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
                    </Label>
                    <Label text="Contains synthetic media">
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
                    </Label>
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
                <TextField
                  disabled={socialLocked}
                  label={t("Campaign start (device local time)")}
                  type="datetime-local"
                  required
                  value={localInput(config.schedule.startsAt)}
                  onChange={(e) => schedule("startsAt", new Date(e.target.value).getTime())}
                />
                <TextField
                  disabled={socialLocked}
                  label={t("Campaign end (optional)")}
                  type="datetime-local"
                  value={config.schedule.endsAt ? localInput(config.schedule.endsAt) : ""}
                  onChange={(e) =>
                    schedule(
                      "endsAt",
                      e.target.value ? new Date(e.target.value).getTime() : undefined,
                    )
                  }
                />
                <TextField
                  label={t("Total logical posts")}
                  type="number"
                  min={1}
                  max={10000}
                  disabled={socialLocked || config.totalPosts === null}
                  value={config.totalPosts ?? ""}
                  onChange={(e) => set("totalPosts", Number(e.target.value))}
                />
                <Label text="Continuous campaign">
                  <Checkbox
                    disabled={socialLocked}
                    checked={config.totalPosts === null}
                    onChange={(e) => set("totalPosts", e.target.checked ? null : 10)}
                  />
                </Label>
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
                    <TextField
                      disabled={socialLocked}
                      label={t("Window start")}
                      type="time"
                      value={config.schedule.startTime}
                      onChange={(e) => schedule("startTime", e.target.value)}
                    />
                    <TextField
                      disabled={socialLocked}
                      label={t("Window end")}
                      type="time"
                      value={config.schedule.endTime}
                      onChange={(e) => schedule("endTime", e.target.value)}
                    />
                    {config.schedule.mode === "interval" ? (
                      <>
                        <TextField
                          disabled={socialLocked}
                          label={t("Minimum interval (minutes)")}
                          type="number"
                          min={1}
                          value={config.schedule.minIntervalMinutes}
                          onChange={(e) => schedule("minIntervalMinutes", Number(e.target.value))}
                        />
                        <TextField
                          disabled={socialLocked}
                          label={t("Maximum interval (minutes)")}
                          type="number"
                          min={1}
                          value={config.schedule.maxIntervalMinutes}
                          onChange={(e) => schedule("maxIntervalMinutes", Number(e.target.value))}
                        />
                      </>
                    ) : (
                      <>
                        <TextField
                          disabled={socialLocked}
                          label={t("Posts per period")}
                          type="number"
                          min={1}
                          max={48}
                          value={config.schedule.frequency}
                          onChange={(e) => schedule("frequency", Number(e.target.value))}
                        />
                        <Label text="Period">
                          <NativeSelect
                            disabled={socialLocked}
                            value={config.schedule.period}
                            onChange={(e) => schedule("period", e.target.value as "day" | "week")}
                          >
                            <option value="day">{t("Day")}</option>
                            <option value="week">{t("Week")}</option>
                          </NativeSelect>
                        </Label>
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
                        .map((step) => t(steps[step]))
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
                    {t(steps[step])}
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
                    <TextField
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
                      type="number"
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
                disabled={socialLocked}
                variant="primary"
                type="button"
                onClick={() => setSetupStep((step) => step + 1)}
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
      <div className={programs.length ? "social-program-workspace" : undefined}>
        <div className="social-program-list">
          {programs.map((p) => (
            <Button
              variant="tab"
              loading={pendingUi.is(`program.select:${p.id}`)}
              type="button"
              key={p.id}
              disabled={socialLocked || busy}
              aria-pressed={detail?.program.id === p.id}
              onClick={() =>
                void pendingUi.run(`program.select:${p.id}`, () =>
                  run(async () => {
                    setDetail(await client.request<ProgramDetail>("programs.status", { id: p.id }));
                    setConfirmed(false);
                  }),
                )
              }
            >
              <strong>{p.name}</strong>
              <span>
                {p.enabled ? t("Active") : p.cancelled ? t("Cancelled") : t("Paused")} ·{" "}
                {p.nextSequence}/{p.totalPosts ?? "∞"}
              </span>
            </Button>
          ))}
        </div>
        {detail ? (
          <section className="social-program-detail">
            <header className="social-record-heading">
              <h3>{detail.program.name}</h3>
              <span className="social-muted">
                {detail.program.enabled ? t("Active") : t("Paused")}
              </span>
            </header>
            {detail.program.reason ? <Notice>{detail.program.reason}</Notice> : null}
            <details className="social-program-advanced">
              <summary>{t("Generation usage")}</summary>
              <p className="social-muted">
                {t("Generation usage")}: {detail.program.generationCount}/
                {detail.program.limits.totalGenerations} · {t("Images")}:{" "}
                {detail.program.imageGenerationCount}/{detail.program.limits.maxImageGenerations}
              </p>
            </details>
            <details className="social-program-advanced">
              <summary>{t("Link for future drafts")}</summary>
              <TextField
                disabled={socialLocked}
                label={t("Link for future drafts")}
                type="url"
                value={bulkLink}
                onChange={(e) => setBulkLink(e.target.value)}
              />
              <Button
                type="button"
                variant="secondary"
                loading={pendingUi.is("programs.apply-link-to-editable-drafts")}
                disabled={socialLocked || busy}
                onClick={() =>
                  void pendingUi.run("programs.apply-link-to-editable-drafts", () =>
                    perform("programs.bulk-edit", {
                      id: detail.program.id,
                      expectedRevision: detail.program.revision,
                      link: bulkLink,
                    }),
                  )
                }
              >
                {t("Apply link to editable drafts")}
              </Button>
            </details>
            <div className="social-toolbar-actions">
              <Button
                type="button"
                variant="secondary"
                loading={pendingUi.is("programs.generate-next-content")}
                disabled={socialLocked || busy || detail.program.cancelled}
                onClick={() =>
                  void pendingUi.run("programs.generate-next-content", () =>
                    perform("programs.generate", { id: detail.program.id }),
                  )
                }
              >
                {t("Generate next content")}
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={socialLocked || busy}
                onClick={() => {
                  const {
                    id: _,
                    revision: __,
                    enabled: ___,
                    cancelled: ____,
                    reason: _____,
                    createdAt: ______,
                    updatedAt: _______,
                    executorId: ________,
                    generationCount: _________,
                    imageGenerationCount: __________,
                    generationDay: ___________,
                    dailyGenerationCount: ____________,
                    nextSequence: _____________,
                    nextAt: ______________,
                    authorization: _______________,
                    ...c
                  } = detail.program;
                  setConfig(c);
                  setEdit(detail.program);
                  setEditVersion((v) => v + 1);
                }}
              >
                {t("Edit campaign settings")}
              </Button>
              <Button
                type="button"
                variant="secondary"
                loading={pendingUi.is("programs.pause")}
                disabled={socialLocked || busy}
                onClick={() =>
                  void pendingUi.run("programs.pause", () =>
                    perform("programs.pause", { id: detail.program.id }),
                  )
                }
              >
                {t("Pause")}
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-2 border-t border-(--ui-tone-neutral-border) pt-2">
              <ConfirmMorph
                label={t("Cancel future publications")}
                tone="danger"
                confirmLabel={t("Cancel publications")}
                pendingLabel={t("Cancelling…")}
                doneLabel={t("Cancelled")}
                errorLabel={t("Cancel failed")}
                disabled={busy || detail.program.cancelled}
                onConfirm={async () => {
                  if (!(await perform("programs.cancel", { id: detail.program.id })))
                    throw new Error(t("Cancel failed"));
                }}
              />
            </div>
            <label className="social-program-confirm">
              <Checkbox
                disabled={socialLocked}
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              {t(
                "I reviewed this revision, its accounts, schedule, models, budgets and approval steps.",
              )}
            </label>
            {detail.program.enabled || detail.program.cancelled || !confirmed ? (
              <small className="social-muted">
                {detail.program.cancelled
                  ? t("This campaign was cancelled.")
                  : detail.program.enabled
                    ? t("This campaign is already active.")
                    : t("Tick the review confirmation above to activate.")}
              </small>
            ) : null}
            <div className="social-actions">
              {detail.program.accountIds.map((accountId) => (
                <Badge key={accountId} variant="label" appearance="outline">
                  {snapshot.accounts.find((account) => account.id === accountId)?.name ?? accountId}
                </Badge>
              ))}
              <Button
                type="button"
                variant="secondary"
                loading={pendingUi.is("programs.activate-reviewed-campaign")}
                disabled={
                  socialLocked ||
                  busy ||
                  !confirmed ||
                  detail.program.cancelled ||
                  detail.program.enabled
                }
                onClick={() =>
                  void pendingUi.run("programs.activate-reviewed-campaign", () =>
                    perform("programs.activate", {
                      id: detail.program.id,
                      expectedRevision: detail.program.revision,
                      confirm: true,
                    }),
                  )
                }
              >
                {t("Activate reviewed campaign")}
              </Button>
            </div>
            {!snapshot.sendingEnabled || snapshot.stopped ? (
              <Notice>
                {t(
                  "External sending is disabled. Campaign activation does not change sending permissions.",
                )}
              </Notice>
            ) : null}
            <div className="social-program-calendar">
              {detail.occurrences.map((o) => (
                <article key={o.id}>
                  <header>
                    <strong>#{o.sequence + 1}</strong>
                    <time>
                      {dateTimeFormat(locale, {
                        dateStyle: "medium",
                        timeStyle: "short",
                        timeZone: detail.program.schedule.timeZone,
                      }).format(o.scheduledAt)}
                    </time>
                  </header>
                  {o.originalAt !== o.scheduledAt ? (
                    <p>
                      {t("Rescheduled from")}:{" "}
                      {dateTimeFormat(locale, {
                        year: "numeric",
                        month: "numeric",
                        day: "numeric",
                        hour: "numeric",
                        minute: "numeric",
                        second: "numeric",
                      }).format(new Date(o.originalAt))}
                    </p>
                  ) : null}
                  {!o.targets.some((t) => t.jobId) ? (
                    <TextField
                      label={t("Reschedule (device local time)")}
                      type="datetime-local"
                      disabled={socialLocked || busy}
                      defaultValue={localInput(o.scheduledAt)}
                      onBlur={(e) => {
                        const at = new Date(e.target.value).getTime();
                        if (at !== o.scheduledAt && Number.isFinite(at))
                          void perform("programs.reschedule", {
                            id: detail.program.id,
                            occurrenceId: o.id,
                            scheduledAt: at,
                          });
                      }}
                    />
                  ) : null}
                  {o.targets.map((target) => (
                    <TargetEditor
                      key={`${o.id}:${target.accountId}`}
                      target={target}
                      occurrence={o}
                      program={detail.program}
                      busy={busy}
                      perform={perform}
                      client={client}
                      accountName={
                        snapshot.accounts.find((account) => account.id === target.accountId)?.name
                      }
                    />
                  ))}
                </article>
              ))}
            </div>
            {detail.nextBefore !== undefined ? (
              <Button
                loading={pendingUi.is("programs.load-older-posts")}
                disabled={socialLocked}
                type="button"
                variant="secondary"
                onClick={() =>
                  void pendingUi.run("programs.load-older-posts", () =>
                    run(async () => {
                      const older = await client.request<ProgramDetail>("programs.status", {
                        id: detail.program.id,
                        before: detail.nextBefore,
                      });
                      setDetail((d) =>
                        d
                          ? { ...older, occurrences: [...older.occurrences, ...d.occurrences] }
                          : older,
                      );
                    }),
                  )
                }
              >
                {t("Load older posts")}
              </Button>
            ) : null}
          </section>
        ) : null}
      </div>
    </section>
  );
}

function TargetEditor({
  target,
  occurrence,
  program,
  busy,
  perform,
  client,
  accountName,
}: {
  accountName?: string;
  target: ProgramTarget;
  occurrence: SocialOccurrence;
  program: SocialProgram;
  busy: boolean;
  perform: (action: string, input: Record<string, unknown>) => Promise<boolean>;
  client: Props["client"];
}) {
  const pendingUi = useSocialPending();
  const socialLocked = useSocialContext(SocialLockContext);
  const [variant, setVariant] = useState<CampaignVariant | undefined>(target.variant),
    [selectedSteps, setSelectedSteps] = useState<string[]>([]),
    [images, setImages] = useState<Record<string, string>>({}),
    [imageErrors, setImageErrors] = useState<Record<string, boolean>>({}),
    [urlRetries, setUrlRetries] = useState<Record<string, boolean>>({});
  const dirty = useRef(false);
  const imageVersion = useRef(0);
  const mediaKey = target.variant?.media.map((m) => m.uploadId ?? m.url).join("|");
  useEffect(() => {
    imageVersion.current++;
    setImages({});
    setImageErrors({});
    setUrlRetries({});
    return () => {
      imageVersion.current++;
    };
  }, [mediaKey]);
  useEffect(() => {
    if (!dirty.current) setVariant(target.variant);
  }, [target.variant]);
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
        {names[target.platform]} · {t(states[target.status] ?? target.status)}
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
              dirty.current = true;
              setVariant({ ...variant, text: e.target.value });
            }}
          />
          <TextField
            label={t("Public link")}
            type="url"
            disabled={socialLocked || busy || !!target.jobId}
            value={variant.link ?? ""}
            onChange={(e) => {
              dirty.current = true;
              setVariant({ ...variant, link: e.target.value || undefined });
            }}
          />
          {variant.youtube ? (
            <>
              <TextField
                label={t("Video title")}
                disabled={socialLocked || busy || !!target.jobId}
                value={variant.youtube.title}
                onChange={(e) => {
                  dirty.current = true;
                  setVariant({
                    ...variant,
                    youtube: { ...variant.youtube!, title: e.target.value },
                  });
                }}
              />
              <Label text="Video visibility">
                <NativeSelect
                  disabled={socialLocked || busy || !!target.jobId}
                  value={variant.youtube.privacy}
                  onChange={(e) => {
                    dirty.current = true;
                    setVariant({
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
              </Label>
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
                      dirty.current = true;
                      setVariant({
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
                        dirty.current = false;
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
                      {t(steps[step])}
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
                  dirty.current ||
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
