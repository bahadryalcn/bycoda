import { t } from "../../../shared/i18n";
import type { HostProject } from "../../connections/model/protocol";
import type { CampaignVariant, SocialSnapshot } from "./social";
import type { ProgramConfig, SocialProgram } from "./socialProgram";

/** Display labels of the approvable generation steps. */
export const PROGRAM_STEP_LABELS: Record<string, string> = {
  text: "Text",
  image: "Image",
  adaptation: "Platform adaptation",
  schedule: "Schedule",
  publish: "Final publication",
};

/** Section labels used when a suggested configuration is reviewed field by field. */
export const PROGRAM_SUGGESTION_FIELD_LABELS: Record<string, string> = {
  name: "Campaign name",
  projectId: "Project",
  accountIds: "Target accounts",
  brief: "Purpose and content",
  textAgent: "Text model",
  image: "AI models and media",
  strategy: "Content strategy",
  poolCampaignIds: "Content pool",
  approval: "Approval and limits",
  schedule: "Publishing schedule",
  totalPosts: "Total posts",
  limits: "Generation limits",
  youtube: "YouTube",
  mediaOverrides: "Media",
};

/** `datetime-local` value for an epoch timestamp in the device time zone. */
export const localDateTimeInput = (at: number) => {
  const d = new Date(at);
  return new Date(at - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

/** Editable configuration of a stored program (identity and runtime state removed). */
export function programConfigFromProgram(program: SocialProgram): ProgramConfig {
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
    ...config
  } = program;
  return config;
}

/** Human-readable summary of one field of an AI-suggested configuration. */
export function summarizeProgramSuggestion(
  key: string,
  value: ProgramConfig,
  context: {
    locale: string;
    snapshot: Pick<SocialSnapshot, "accounts" | "profiles" | "campaigns">;
    projects: HostProject[];
  },
): string {
  const { locale, snapshot, projects } = context;
  const scheduleDate = (at: number) => {
    try {
      return new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: value.schedule.timeZone,
      }).format(at);
    } catch {
      return t("Invalid date or time zone — review the schedule.");
    }
  };
  const accountNames = (ids: string[]) =>
    ids
      .map(
        (id) =>
          snapshot.accounts.find((account) => account.id === id)?.name ?? t("Removed account"),
      )
      .join(", ");
  const mediaSummary = (media: CampaignVariant["media"]) =>
    media.length
      ? media.map((item) => `${item.kind}: ${item.url || t("Uploaded media")}`).join(" · ")
      : t("No media");
  switch (key) {
    case "name":
      return value.name;
    case "projectId":
      return (
        projects.find((project) => project.id === value.projectId)?.name ?? t("Select project")
      );
    case "accountIds":
      return accountNames(value.accountIds);
    case "brief":
      return [
        [t("Topic"), value.brief.topic],
        [t("Title"), value.brief.title],
        [t("Description"), value.brief.description],
        [t("Audience"), value.brief.audience],
        [t("Language"), value.brief.language],
        [t("Voice"), value.brief.voice],
        [t("Call to action"), value.brief.cta],
        [t("Link"), value.brief.link],
        [
          t("Verified facts"),
          value.brief.factIds
            .map(
              (id) =>
                snapshot.profiles.flatMap((profile) => profile.facts).find((fact) => fact.id === id)
                  ?.topic ?? id,
            )
            .join(", "),
        ],
        [t("Content angles"), value.brief.angles?.join(", ")],
      ]
        .filter(([, text]) => !!text)
        .map(([label, text]) => `${label}: ${text}`)
        .join("\n");
    case "textAgent":
      return value.textAgent
        ? `${value.textAgent.provider} · ${value.textAgent.model || t("Use project defaults")}`
        : t("Use project defaults");
    case "image":
      return `${t(value.image.mode === "none" ? "No media" : value.image.mode === "generate" ? "Generate image" : "Existing media")} · ${value.image.aspectRatio}\n${value.image.mode === "generate" ? `${value.image.provider} · ${value.image.model || t("Use project defaults")}` : mediaSummary(value.image.media)}`;
    case "schedule":
      return `${scheduleDate(value.schedule.startsAt)} · ${value.schedule.timeZone}\n${t("Days")}: ${value.schedule.days.map((day) => new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(Date.UTC(2024, 0, day))).join(", ")}\n${value.schedule.mode === "times" ? value.schedule.times.join(", ") : value.schedule.mode === "frequency" ? `${value.schedule.frequency} / ${t(value.schedule.period === "day" ? "Day" : "Week")}` : `${value.schedule.minIntervalMinutes}–${value.schedule.maxIntervalMinutes} ${t("Minutes")}`} · ${value.schedule.startTime}–${value.schedule.endTime}${value.schedule.endsAt ? `\n${t("End date")}: ${scheduleDate(value.schedule.endsAt)}` : ""}`;
    case "limits":
      return `${t("Daily posts")}: ${value.limits.dailyPosts} · ${t("Daily generations")}: ${value.limits.dailyGenerations}\n${t("Total generations")}: ${value.limits.totalGenerations} · ${t("Image generations")}: ${value.limits.maxImageGenerations}`;
    case "totalPosts":
      return value.totalPosts === null ? t("Unlimited") : String(value.totalPosts);
    case "strategy":
      return t(
        value.strategy === "unique"
          ? "New content for each post"
          : value.strategy === "repeat"
            ? "Repeat approved content"
            : "Rotate approved content pool",
      );
    case "poolCampaignIds":
      return value.poolCampaignIds
        .map((id) => snapshot.campaigns.find((campaign) => campaign.id === id)?.name ?? id)
        .join(", ");
    case "approval":
      return `${t(value.approval.mode === "approved" ? "Approved" : value.approval.mode === "semi" ? "Semi-approved: first sample and plan" : "Automatic")} · ${value.approval.steps.map((step) => t(PROGRAM_STEP_LABELS[step] ?? step)).join(", ")}`;
    case "mediaOverrides":
      return Object.entries(value.mediaOverrides ?? {})
        .map(([id, media]) => `${accountNames([id])}: ${mediaSummary(media)}`)
        .join("\n");
    case "youtube":
      return value.youtube
        ? t("YouTube settings changed. Review the exact settings below.")
        : t("Use project defaults");
    default:
      return t("Review the exact settings below.");
  }
}
