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
import { t, useLocale } from "../../../shared/i18n";
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
import { Composer, Notice, closeComposer, names, type Props } from "./socialShared";
import "./social-programs.css";

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
function Label({ text, children }: { text: string; children: ReactNode }) {
  const id = useId();
  return (
    <label className="social-program-field">
      <span id={id}>{t(text)}</span>
      {Children.map(children, (child) =>
        isValidElement<Record<string, unknown>>(child) &&
        typeof child.type === "string" &&
        ["input", "select", "textarea"].includes(child.type)
          ? cloneElement(child, { "aria-labelledby": id })
          : child,
      )}
    </label>
  );
}
const localInput = (at: number) => {
  const d = new Date(at);
  return new Date(at - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

export function SocialPrograms({ client, snapshot, projects, initialProject, run }: Props) {
  const locale = useLocale(),
    active = useContext(SocialPanelActiveContext),
    busy = useContext(SocialBusyContext);
  const formId = useId();
  const [programs, setPrograms] = useState<SocialProgram[]>([]),
    [detail, setDetail] = useState<ProgramDetail>(),
    [features, setFeatures] = useState<ProgramFeatures>();
  const [config, setConfig] = useState<ProgramConfig>(() => defaultProgram(initialProject)),
    [edit, setEdit] = useState<SocialProgram>(),
    [instructions, setInstructions] = useState(""),
    [questions, setQuestions] = useState<string[]>([]),
    [preview, setPreview] = useState<number[]>([]),
    [error, setError] = useState(""),
    [confirmed, setConfirmed] = useState(false);
  const [bulkLink, setBulkLink] = useState("");
  const [editVersion, setEditVersion] = useState(0);
  useEffect(
    () => setConfirmed(false),
    [detail?.program.id, detail?.program.revision, detail?.program.enabled, detail?.program.reason],
  );
  const detailId = useRef<string | undefined>(undefined),
    revision = useRef(0);
  detailId.current = detail?.program.id;
  useEffect(() => {
    if (
      detail &&
      snapshot.programProjectId &&
      detail.program.projectId !== snapshot.programProjectId
    ) {
      detailId.current = undefined;
      setDetail(undefined);
    }
  }, [snapshot.programProjectId, detail?.program.projectId]);
  const displayDate = (at: number) =>
    new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: config.schedule.timeZone,
    }).format(at);
  useEffect(() => {
    if (!snapshot.programsSupported || !active) return;
    const epoch = ++revision.current;
    let stopped = false,
      timeout: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const selectedId = detailId.current;
        const [list, current] = await Promise.all([
          client.request<SocialProgram[]>(
            "programs.list",
            snapshot.programProjectId ? { projectId: snapshot.programProjectId } : {},
          ),
          selectedId
            ? client.request<ProgramDetail>("programs.status", { id: selectedId })
            : Promise.resolve(undefined),
        ]);
        if (stopped || epoch !== revision.current) return;
        setPrograms(list);
        if (current && selectedId === detailId.current) setDetail(current);
        setError("");
      } catch (e) {
        if (!stopped) setError(e instanceof Error ? e.message : t("Refresh failed."));
      } finally {
        if (!stopped) timeout = setTimeout(load, 5000);
      }
    };
    void load();
    return () => {
      stopped = true;
      revision.current++;
      clearTimeout(timeout);
    };
  }, [client, active, snapshot.programsSupported, snapshot.programProjectId]);
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
      <div className="social-section-heading">
        <h2>{t("AI campaign programs")}</h2>
        <p>{t("Generate, review and schedule posts from one brief.")}</p>
      </div>
      {error ? <Notice kind="error">{error}</Notice> : null}
      <Composer
        title={edit ? t("Edit campaign program") : t("Create AI campaign")}
        editing={editVersion}
      >
        <form
          className="social-program-form"
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget;
            void perform("programs.configure", {
              config,
              ...(edit ? { id: edit.id, expectedRevision: edit.revision } : {}),
            }).then((saved) => {
              if (saved) closeComposer(form);
            });
          }}
        >
          <fieldset disabled={busy}>
            <legend>{t("Purpose and content")}</legend>
            <div className="social-program-grid">
              <Label text="Campaign name">
                <input required value={config.name} onChange={(e) => set("name", e.target.value)} />
              </Label>
              <Label text="Project">
                <select
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
                >
                  <option value="">{t("Select project")}</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </Label>
              <Label text="Topic">
                <input
                  required
                  value={config.brief.topic}
                  onChange={(e) => brief("topic", e.target.value)}
                />
              </Label>
              <Label text="Title">
                <input
                  value={config.brief.title}
                  onChange={(e) => brief("title", e.target.value)}
                />
              </Label>
            </div>
            <Label text="Description">
              <textarea
                required
                rows={3}
                value={config.brief.description}
                onChange={(e) => brief("description", e.target.value)}
              />
            </Label>
            <div className="social-program-grid">
              <Label text="Audience">
                <input
                  value={config.brief.audience}
                  onChange={(e) => brief("audience", e.target.value)}
                />
              </Label>
              <Label text="Content language">
                <input
                  value={config.brief.language}
                  onChange={(e) => brief("language", e.target.value)}
                />
              </Label>
              <Label text="Brand voice">
                <input
                  value={config.brief.voice}
                  onChange={(e) => brief("voice", e.target.value)}
                />
              </Label>
              <Label text="Call to action">
                <input value={config.brief.cta} onChange={(e) => brief("cta", e.target.value)} />
              </Label>
              <Label text="Content angles (comma separated)">
                <input
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
              </Label>
              <Label text="Public link">
                <input
                  type="url"
                  value={config.brief.link ?? ""}
                  onChange={(e) => brief("link", e.target.value)}
                />
              </Label>
            </div>
            <Label text="Content template">
              <select
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
              </select>
            </Label>
            <button
              type="button"
              disabled={!config.brief.link}
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
            </button>
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
            <button
              type="button"
              onClick={() =>
                void run(async () =>
                  setFeatures(await client.request<ProgramFeatures>("programs.features")),
                )
              }
            >
              {t("Check model and platform availability")}
            </button>
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
          </fieldset>
          <fieldset disabled={busy}>
            <legend>{t("AI models and media")}</legend>
            <div className="social-program-grid">
              <Label text="Text provider">
                <select
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
                </select>
              </Label>
              <Label text="Text model">
                <input
                  list={`${formId}-models`}
                  value={config.textAgent?.model ?? ""}
                  disabled={!config.textAgent}
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
              </Label>
              <Label text="Media source">
                <select
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
                </select>
              </Label>
              {config.image.mode === "generate" ? (
                <>
                  <Label text="Image provider">
                    <select
                      value={config.image.provider}
                      onChange={(e) =>
                        set("image", {
                          ...config.image,
                          provider: e.target.value as ProgramConfig["image"]["provider"],
                          model: undefined,
                        })
                      }
                    >
                      <option value="automatic">{t("Automatic: Codex → Gemini → ComfyUI")}</option>
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
                    </select>
                  </Label>
                  <Label text="Image model">
                    <input
                      disabled={config.image.provider === "automatic"}
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
                  </Label>
                  <Label text="Aspect ratio">
                    <select
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
                    </select>
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
                    <select
                      value=""
                      onChange={(e) => {
                        const media = snapshot.campaigns
                          .flatMap((c) => c.variants)
                          .flatMap((v) => v.media)
                          .find((m) => (m.uploadId ?? m.url) === e.target.value);
                        if (media) set("image", { ...config.image, media: [media] });
                      }}
                    >
                      <option value="">{t("Select saved media")}</option>
                      {[
                        ...new Map(
                          snapshot.campaigns
                            .flatMap((c) => c.variants)
                            .flatMap((v) => v.media)
                            .map((m) => [m.uploadId ?? m.url, m]),
                        ).values(),
                      ].map((m, i) => (
                        <option key={i} value={m.uploadId ?? m.url}>
                          {m.alt || `${m.kind} ${i + 1}`}
                        </option>
                      ))}
                    </select>
                  </Label>
                  <Label text="Upload image or video">
                    <input
                      type="file"
                      accept="image/png,image/jpeg,video/mp4,video/webm"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file)
                          void run(async () => {
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
                          });
                      }}
                    />
                  </Label>
                  <Label text="Public image URL">
                    <input
                      type="url"
                      value={config.image.media[0]?.url ?? ""}
                      onChange={(e) =>
                        set("image", {
                          ...config.image,
                          media: e.target.value ? [{ kind: "image", url: e.target.value }] : [],
                        })
                      }
                    />
                  </Label>
                  <p>{config.image.media[0]?.uploadId ? t("Media uploaded") : ""}</p>
                </>
              ) : null}
            </div>
            <Label text="Content strategy">
              <select
                value={config.strategy}
                onChange={(e) => set("strategy", e.target.value as ProgramConfig["strategy"])}
              >
                <option value="unique">{t("Unique content for every post")}</option>
                <option
                  value="repeat"
                  disabled={config.accountIds.some(
                    (id) => snapshot.accounts.find((a) => a.id === id)?.platform === "x",
                  )}
                >
                  {t("Repeat approved content")}
                </option>
                <option
                  value="pool"
                  disabled={config.accountIds.some(
                    (id) => snapshot.accounts.find((a) => a.id === id)?.platform === "x",
                  )}
                >
                  {t("Rotate approved content pool")}
                </option>
              </select>
            </Label>
            <details>
              <summary>{t("Account-specific media")}</summary>
              {config.accountIds.map((id) => (
                <section key={id}>
                  <strong>{snapshot.accounts.find((a) => a.id === id)?.name}</strong>
                  <Label text="Override media">
                    <input
                      type="file"
                      accept="image/png,image/jpeg,video/mp4,video/webm"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file)
                          void run(async () => {
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
                          });
                      }}
                    />
                  </Label>
                  <Label text="Use text only">
                    <input
                      type="checkbox"
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
                      <button
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
                      </button>
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
                <Label text="Video title">
                  <input
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
                </Label>
                <Label text="Video visibility">
                  <select
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
                  </select>
                </Label>
                <Label text="Made for kids">
                  <input
                    type="checkbox"
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
                  <input
                    type="checkbox"
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
          <fieldset disabled={busy}>
            <legend>{t("Publishing schedule")}</legend>
            <div className="social-program-grid">
              <Label text="Schedule mode">
                <select
                  value={config.schedule.mode}
                  onChange={(e) =>
                    schedule("mode", e.target.value as ProgramConfig["schedule"]["mode"])
                  }
                >
                  <option value="times">{t("Specific times")}</option>
                  <option value="interval">{t("Intervals")}</option>
                  <option value="frequency">{t("Posting frequency")}</option>
                </select>
              </Label>
              <Label text="Time zone">
                <input
                  required
                  value={config.schedule.timeZone}
                  onChange={(e) => schedule("timeZone", e.target.value)}
                />
              </Label>
              <Label text="Campaign start (device local time)">
                <input
                  type="datetime-local"
                  required
                  value={localInput(config.schedule.startsAt)}
                  onChange={(e) => schedule("startsAt", new Date(e.target.value).getTime())}
                />
              </Label>
              <Label text="Campaign end (optional)">
                <input
                  type="datetime-local"
                  value={config.schedule.endsAt ? localInput(config.schedule.endsAt) : ""}
                  onChange={(e) =>
                    schedule(
                      "endsAt",
                      e.target.value ? new Date(e.target.value).getTime() : undefined,
                    )
                  }
                />
              </Label>
              <Label text="Total logical posts">
                <input
                  type="number"
                  min={1}
                  max={10000}
                  disabled={config.totalPosts === null}
                  value={config.totalPosts ?? ""}
                  onChange={(e) => set("totalPosts", Number(e.target.value))}
                />
              </Label>
              <Label text="Continuous campaign">
                <input
                  type="checkbox"
                  checked={config.totalPosts === null}
                  onChange={(e) => set("totalPosts", e.target.checked ? null : 10)}
                />
              </Label>
              {config.schedule.mode === "times" ? (
                <Label text="Publishing times (HH:mm, comma separated)">
                  <input
                    required
                    value={config.schedule.times.join(", ")}
                    onChange={(e) =>
                      schedule(
                        "times",
                        e.target.value.split(",").map((x) => x.trim()),
                      )
                    }
                  />
                </Label>
              ) : (
                <>
                  <Label text="Window start">
                    <input
                      type="time"
                      value={config.schedule.startTime}
                      onChange={(e) => schedule("startTime", e.target.value)}
                    />
                  </Label>
                  <Label text="Window end">
                    <input
                      type="time"
                      value={config.schedule.endTime}
                      onChange={(e) => schedule("endTime", e.target.value)}
                    />
                  </Label>
                  {config.schedule.mode === "interval" ? (
                    <>
                      <Label text="Minimum interval (minutes)">
                        <input
                          type="number"
                          min={1}
                          value={config.schedule.minIntervalMinutes}
                          onChange={(e) => schedule("minIntervalMinutes", Number(e.target.value))}
                        />
                      </Label>
                      <Label text="Maximum interval (minutes)">
                        <input
                          type="number"
                          min={1}
                          value={config.schedule.maxIntervalMinutes}
                          onChange={(e) => schedule("maxIntervalMinutes", Number(e.target.value))}
                        />
                      </Label>
                    </>
                  ) : (
                    <>
                      <Label text="Posts per period">
                        <input
                          type="number"
                          min={1}
                          max={48}
                          value={config.schedule.frequency}
                          onChange={(e) => schedule("frequency", Number(e.target.value))}
                        />
                      </Label>
                      <Label text="Period">
                        <select
                          value={config.schedule.period}
                          onChange={(e) => schedule("period", e.target.value as "day" | "week")}
                        >
                          <option value="day">{t("Day")}</option>
                          <option value="week">{t("Week")}</option>
                        </select>
                      </Label>
                    </>
                  )}
                </>
              )}
            </div>
            <div className="social-program-days">
              {[1, 2, 3, 4, 5, 6, 7].map((day) => (
                <label key={day}>
                  <input
                    type="checkbox"
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
                  {new Intl.DateTimeFormat(locale, { weekday: "short" }).format(
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
            <button
              type="button"
              onClick={() =>
                void run(async () => {
                  const result = await client.request<{ dates: number[] }>(
                    "programs.preview-schedule",
                    { config },
                  );
                  setPreview(result.dates);
                })
              }
            >
              {t("Preview publishing times")}
            </button>
            {preview.length ? (
              <ol>
                {preview.map((at) => (
                  <li key={at}>{displayDate(at)}</li>
                ))}
              </ol>
            ) : null}
          </fieldset>
          <fieldset disabled={busy}>
            <legend>{t("Approval and limits")}</legend>
            <Label text="Approval mode">
              <select
                value={config.approval.mode}
                onChange={(e) => {
                  const mode = e.target.value as ProgramConfig["approval"]["mode"];
                  set("approval", { mode, steps: programApprovalSteps(mode) });
                }}
              >
                <option value="approved">{t("Approved")}</option>
                <option value="semi">{t("Semi-approved: first sample and plan")}</option>
                <option value="automatic">{t("Automatic after explicit activation")}</option>
              </select>
            </Label>
            <div className="social-program-days">
              {PROGRAM_STEPS.map((step) => (
                <label key={step}>
                  <input
                    type="checkbox"
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
            <div className="social-program-grid">
              {(
                [
                  "dailyPosts",
                  "dailyGenerations",
                  "totalGenerations",
                  "maxImageGenerations",
                ] as const
              ).map((key) => (
                <Label
                  key={key}
                  text={
                    {
                      dailyPosts: "Daily posts per account",
                      dailyGenerations: "Daily generation budget",
                      totalGenerations: "Total generation budget",
                      maxImageGenerations: "Image generation budget",
                    }[key]
                  }
                >
                  <input
                    type="number"
                    min={1}
                    max={100000}
                    value={config.limits[key]}
                    onChange={(e) =>
                      set("limits", { ...config.limits, [key]: Number(e.target.value) })
                    }
                  />
                </Label>
              ))}
            </div>
            <p>
              {t(
                "Generation counts are hard limits. Unknown provider costs are not shown as zero.",
              )}
            </p>
          </fieldset>
          <details>
            <summary>{t("Describe the campaign to AI")}</summary>
            <Label text="Campaign instructions">
              <textarea
                rows={3}
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
              />
            </Label>
            <button
              type="button"
              disabled={busy || !instructions.trim()}
              onClick={() =>
                void run(async () => {
                  const result = await client.request<{
                    config: ProgramConfig;
                    questions: string[];
                  }>("programs.suggest", { config, instructions });
                  setConfig(result.config);
                  setQuestions(result.questions);
                })
              }
            >
              {t("Fill settings with AI")}
            </button>
            {questions.map((q, i) => (
              <p key={i}>{q}</p>
            ))}
          </details>
          <button type="submit" disabled={busy}>
            {t("Save paused campaign")}
          </button>
          {edit ? (
            <button
              type="button"
              onClick={() => {
                setEdit(undefined);
                setConfig(defaultProgram(initialProject));
              }}
            >
              {t("New campaign")}
            </button>
          ) : null}
        </form>
      </Composer>
      <div className="social-program-list">
        {programs.map((p) => (
          <button
            type="button"
            key={p.id}
            disabled={busy}
            aria-pressed={detail?.program.id === p.id}
            onClick={() =>
              void run(async () => {
                setDetail(await client.request<ProgramDetail>("programs.status", { id: p.id }));
                setConfirmed(false);
              })
            }
          >
            <strong>{p.name}</strong>
            <span>
              {p.enabled ? t("Active") : p.cancelled ? t("Cancelled") : t("Paused")} ·{" "}
              {p.nextSequence}/{p.totalPosts ?? "∞"}
            </span>
          </button>
        ))}
      </div>
      {detail ? (
        <>
          <h3>{detail.program.name}</h3>
          <p>{detail.program.reason}</p>
          <p>
            {t("Generation usage")}: {detail.program.generationCount}/
            {detail.program.limits.totalGenerations} · {t("Images")}:{" "}
            {detail.program.imageGenerationCount}/{detail.program.limits.maxImageGenerations}
          </p>
          <Label text="Link for future drafts">
            <input type="url" value={bulkLink} onChange={(e) => setBulkLink(e.target.value)} />
          </Label>
          <button
            disabled={busy}
            onClick={() =>
              void perform("programs.bulk-edit", {
                id: detail.program.id,
                expectedRevision: detail.program.revision,
                link: bulkLink,
              })
            }
          >
            {t("Apply link to editable drafts")}
          </button>
          <div className="social-toolbar-actions">
            <button
              disabled={busy || detail.program.cancelled}
              onClick={() => void perform("programs.generate", { id: detail.program.id })}
            >
              {t("Generate next content")}
            </button>
            <button
              disabled={busy}
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
            </button>
            <button
              disabled={busy}
              onClick={() => void perform("programs.pause", { id: detail.program.id })}
            >
              {t("Pause")}
            </button>
            <button
              disabled={busy}
              onClick={() => void perform("programs.cancel", { id: detail.program.id })}
            >
              {t("Cancel future publications")}
            </button>
          </div>
          <label className="social-program-confirm">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            {t(
              "I reviewed this revision, its accounts, schedule, models, budgets and approval steps.",
            )}
          </label>
          <button
            disabled={busy || !confirmed || detail.program.cancelled || detail.program.enabled}
            onClick={() =>
              void perform("programs.activate", {
                id: detail.program.id,
                expectedRevision: detail.program.revision,
                confirm: true,
              })
            }
          >
            {t("Activate reviewed campaign")}
          </button>
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
                    {new Intl.DateTimeFormat(locale, {
                      dateStyle: "medium",
                      timeStyle: "short",
                      timeZone: detail.program.schedule.timeZone,
                    }).format(o.scheduledAt)}
                  </time>
                </header>
                {o.originalAt !== o.scheduledAt ? (
                  <p>
                    {t("Rescheduled from")}: {new Date(o.originalAt).toLocaleString(locale)}
                  </p>
                ) : null}
                {!o.targets.some((t) => t.jobId) ? (
                  <Label text="Reschedule (device local time)">
                    <input
                      type="datetime-local"
                      disabled={busy}
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
                  </Label>
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
                  />
                ))}
              </article>
            ))}
          </div>
          {detail.nextBefore !== undefined ? (
            <button
              onClick={() =>
                void run(async () => {
                  const older = await client.request<ProgramDetail>("programs.status", {
                    id: detail.program.id,
                    before: detail.nextBefore,
                  });
                  setDetail((d) =>
                    d ? { ...older, occurrences: [...older.occurrences, ...d.occurrences] } : older,
                  );
                })
              }
            >
              {t("Load older posts")}
            </button>
          ) : null}
        </>
      ) : null}
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
}: {
  target: ProgramTarget;
  occurrence: SocialOccurrence;
  program: SocialProgram;
  busy: boolean;
  perform: (action: string, input: Record<string, unknown>) => Promise<boolean>;
  client: Props["client"];
}) {
  const [variant, setVariant] = useState<CampaignVariant | undefined>(target.variant),
    [selectedSteps, setSelectedSteps] = useState<string[]>([]),
    [image, setImage] = useState("");
  const dirty = useRef(false);
  const imageVersion = useRef(0);
  const mediaKey = target.variant?.media.map((m) => m.uploadId ?? m.url).join("|");
  useEffect(() => {
    imageVersion.current++;
    setImage("");
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
      if (version === imageVersion.current) setImage(`data:${result.mime};base64,${result.base64}`);
    } catch {
      if (version === imageVersion.current) setImage("");
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
        <button disabled={busy} onClick={() => void perform("programs.regenerate", ids)}>
          {t("Regenerate")}
        </button>
      ) : null}
      {target.imageProvider === "comfyui" &&
      target.generation.providerJobId &&
      variant &&
      !variant.media.length &&
      target.status === "review" ? (
        <button disabled={busy} onClick={() => void perform("programs.resume-image", ids)}>
          {t("Resume existing image job")}
        </button>
      ) : null}
      {variant ? (
        <>
          <Label text="Platform content">
            <textarea
              rows={3}
              disabled={busy || !!target.jobId || target.status === "generating"}
              value={variant.text}
              onChange={(e) => {
                dirty.current = true;
                setVariant({ ...variant, text: e.target.value });
              }}
            />
          </Label>
          <Label text="Public link">
            <input
              type="url"
              disabled={busy || !!target.jobId}
              value={variant.link ?? ""}
              onChange={(e) => {
                dirty.current = true;
                setVariant({ ...variant, link: e.target.value || undefined });
              }}
            />
          </Label>
          {variant.youtube ? (
            <>
              <Label text="Video title">
                <input
                  disabled={busy || !!target.jobId}
                  value={variant.youtube.title}
                  onChange={(e) => {
                    dirty.current = true;
                    setVariant({
                      ...variant,
                      youtube: { ...variant.youtube!, title: e.target.value },
                    });
                  }}
                />
              </Label>
              <Label text="Video visibility">
                <select
                  disabled={busy || !!target.jobId}
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
                </select>
              </Label>
            </>
          ) : null}
          {variant.media.map((media, i) => (
            <div key={i}>
              {media.kind === "image" ? (
                <>
                  {media.url ? (
                    <img src={media.url} alt={media.alt ?? ""} referrerPolicy="no-referrer" />
                  ) : image ? (
                    <img src={image} alt={media.alt ?? ""} />
                  ) : (
                    <button disabled={busy} onClick={() => void previewImage(media.uploadId!)}>
                      {t("Preview generated image")}
                    </button>
                  )}
                  <Label text="Image alt text">
                    <input
                      disabled={busy || !!target.jobId}
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
                  </Label>
                </>
              ) : (
                <p>{t("Uploaded video")}</p>
              )}
            </div>
          ))}
          {!target.jobId ? (
            <div className="social-toolbar-actions">
              <button
                disabled={busy || target.status === "generating"}
                onClick={() =>
                  void perform("programs.edit", {
                    ...ids,
                    expectedRevision: occurrence.revision,
                    variant,
                  }).then((saved) => {
                    if (saved) {
                      dirty.current = false;
                      setSelectedSteps([]);
                    }
                  })
                }
              >
                {t("Save content changes")}
              </button>
              <button
                disabled={busy || target.status === "generating"}
                onClick={() => void perform("programs.regenerate", ids)}
              >
                {t("Regenerate")}
              </button>
              <div className="social-program-days">
                {PROGRAM_STEPS.filter((s) => s !== "image" || program.image.mode !== "none").map(
                  (step) => (
                    <label key={step}>
                      <input
                        type="checkbox"
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
              <button
                disabled={
                  busy || dirty.current || !selectedSteps.length || target.status === "generating"
                }
                onClick={() =>
                  void perform("programs.approve", {
                    ...ids,
                    expectedRevision: occurrence.revision,
                    confirm: true,
                    steps: selectedSteps,
                  })
                }
              >
                {t("Approve selected steps")}
              </button>
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
