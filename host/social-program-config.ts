import type { ProgramConfig } from "../src/features/social/model/socialProgram";
import { PROGRAM_STEPS } from "../src/features/social/model/socialProgram";
import { parseSocialAgent } from "../src/features/social/model/socialPolicy";
import { parseProgramSchedule } from "./social-program-schedule";

function text(value: unknown, maximum = 20000, required = false): string {
  if (
    typeof value !== "string" ||
    value.length > maximum ||
    /\0/.test(value) ||
    (required && !value.trim())
  )
    throw new Error("Invalid campaign text field.");
  return value.trim();
}
function strings(raw: unknown, max = 30): string[] {
  if (!Array.isArray(raw) || raw.length > max) throw new Error("Invalid campaign selection.");
  return [...new Set(raw.map((x) => text(x, 300, true)))];
}
export function parseProgramConfig(raw: unknown): ProgramConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("Invalid campaign configuration.");
  const c = raw as ProgramConfig;
  const allowed = [
    "name",
    "projectId",
    "accountIds",
    "brief",
    "textAgent",
    "image",
    "strategy",
    "poolCampaignIds",
    "approval",
    "schedule",
    "totalPosts",
    "limits",
    "youtube",
    "mediaOverrides",
  ];
  if (Object.keys(c).some((k) => !allowed.includes(k)))
    throw new Error("Unknown or protected campaign field.");
  const name = text(c.name, 200, true),
    projectId = text(c.projectId, 300, true),
    accountIds = strings(c.accountIds);
  if (!accountIds.length) throw new Error("Select at least one account.");
  if (!c.brief || !c.image || !c.approval || !c.limits)
    throw new Error("Complete the campaign configuration.");
  if (
    Object.keys(c.brief).some(
      (k) =>
        ![
          "topic",
          "title",
          "description",
          "audience",
          "language",
          "voice",
          "cta",
          "link",
          "factIds",
          "angles",
        ].includes(k),
    )
  )
    throw new Error("Unknown brief field.");
  const brief = {
    topic: text(c.brief.topic, 1000, true),
    title: text(c.brief.title, 1000),
    description: text(c.brief.description),
    audience: text(c.brief.audience, 1000),
    language: text(c.brief.language, 100, true),
    voice: text(c.brief.voice, 2000),
    cta: text(c.brief.cta, 1000),
    factIds: strings(c.brief.factIds, 100),
    ...(c.brief.angles ? { angles: strings(c.brief.angles, 20) } : {}),
    ...(c.brief.link ? { link: text(c.brief.link, 2048) } : {}),
  };
  if (brief.link) {
    const u = new URL(brief.link);
    if (u.protocol !== "https:" || u.username || u.password)
      throw new Error("Use an HTTPS public link without credentials.");
  }
  if (!["unique", "repeat", "pool"].includes(c.strategy))
    throw new Error("Choose a content strategy.");
  const poolCampaignIds = strings(c.poolCampaignIds, 100);
  if (c.strategy === "pool" && !poolCampaignIds.length)
    throw new Error("Select an approved content pool.");
  if (
    Object.keys(c.image).some(
      (k) => !["mode", "provider", "model", "aspectRatio", "media"].includes(k),
    ) ||
    !["none", "existing", "generate"].includes(c.image.mode) ||
    !["automatic", "codex", "gemini", "comfyui", "openai-api"].includes(c.image.provider) ||
    !["1:1", "4:5", "16:9"].includes(c.image.aspectRatio)
  )
    throw new Error("Invalid image configuration.");
  if (!Array.isArray(c.image.media) || c.image.media.length > 4)
    throw new Error("Select up to four media files.");
  const media = c.image.media.map((m) => {
    if (
      !m ||
      Object.keys(m).some((k) => !["kind", "url", "uploadId", "alt"].includes(k)) ||
      !["image", "video"].includes(m.kind)
    )
      throw new Error("Invalid media.");
    if (!m.url && !m.uploadId) throw new Error("Choose a media source.");
    if (m.url) {
      const u = new URL(text(m.url, 2048, true));
      if (u.protocol !== "https:" || u.username || u.password)
        throw new Error("Use HTTPS media URLs.");
    }
    return {
      kind: m.kind,
      ...(m.url ? { url: m.url } : { uploadId: text(m.uploadId, 300, true) }),
      ...(m.alt ? { alt: text(m.alt, 2000) } : {}),
    };
  });
  if (c.image.mode === "existing" && !media.length) throw new Error("Select existing media.");
  if (
    Object.keys(c.approval).some((k) => !["mode", "steps"].includes(k)) ||
    !["approved", "semi", "automatic"].includes(c.approval.mode) ||
    !Array.isArray(c.approval.steps) ||
    c.approval.steps.some((s) => !PROGRAM_STEPS.includes(s))
  )
    throw new Error("Invalid approval steps.");
  if (
    c.totalPosts !== null &&
    (!Number.isSafeInteger(c.totalPosts) || c.totalPosts < 1 || c.totalPosts > 10000)
  )
    throw new Error("Choose 1–10000 posts or explicit continuous mode.");
  if (
    Object.keys(c.limits).some(
      (k) =>
        !["dailyPosts", "dailyGenerations", "totalGenerations", "maxImageGenerations"].includes(k),
    ) ||
    Object.values(c.limits).length !== 4 ||
    Object.values(c.limits).some((v) => !Number.isSafeInteger(v) || v < 1 || v > 100000)
  )
    throw new Error("Set positive publishing and generation budgets.");
  let youtube: ProgramConfig["youtube"];
  if (c.youtube) {
    if (
      Object.keys(c.youtube).some(
        (k) => !["title", "privacy", "madeForKids", "containsSyntheticMedia"].includes(k),
      ) ||
      !["private", "unlisted", "public"].includes(c.youtube.privacy) ||
      typeof c.youtube.madeForKids !== "boolean" ||
      typeof c.youtube.containsSyntheticMedia !== "boolean"
    )
      throw new Error("Set explicit YouTube declarations.");
    youtube = { ...c.youtube, title: text(c.youtube.title, 100, true) };
  }
  let mediaOverrides: ProgramConfig["mediaOverrides"];
  if (c.mediaOverrides) {
    if (
      typeof c.mediaOverrides !== "object" ||
      Array.isArray(c.mediaOverrides) ||
      Object.keys(c.mediaOverrides).some((id) => !accountIds.includes(id))
    )
      throw new Error("Media override requires a selected account.");
    mediaOverrides = {};
    for (const [id, assets] of Object.entries(c.mediaOverrides)) {
      if (!Array.isArray(assets) || assets.length > 4)
        throw new Error("Invalid account media override.");
      mediaOverrides[id] = assets.map((m) => {
        if (
          !m ||
          Object.keys(m).some((k) => !["kind", "url", "uploadId", "alt"].includes(k)) ||
          !["image", "video"].includes(m.kind) ||
          (!m.url && !m.uploadId)
        )
          throw new Error("Invalid account media.");
        if (m.url) {
          const u = new URL(m.url);
          if (u.protocol !== "https:" || u.username || u.password)
            throw new Error("Use HTTPS account media.");
        }
        return {
          kind: m.kind,
          ...(m.url ? { url: text(m.url, 2048, true) } : {}),
          ...(m.uploadId ? { uploadId: text(m.uploadId, 300, true) } : {}),
          ...(m.alt ? { alt: text(m.alt, 1000) } : {}),
        };
      });
    }
  }
  return {
    name,
    projectId,
    accountIds,
    brief,
    ...(c.textAgent ? { textAgent: parseSocialAgent(c.textAgent) } : {}),
    image: {
      mode: c.image.mode,
      provider: c.image.provider,
      aspectRatio: c.image.aspectRatio,
      media,
      ...(c.image.model ? { model: text(c.image.model, 200, true) } : {}),
    },
    strategy: c.strategy,
    poolCampaignIds,
    approval: { mode: c.approval.mode, steps: [...new Set(c.approval.steps)] },
    schedule: parseProgramSchedule(c.schedule),
    totalPosts: c.totalPosts,
    limits: { ...c.limits },
    ...(youtube ? { youtube } : {}),
    ...(mediaOverrides ? { mediaOverrides } : {}),
  };
}

export function validateGeneratedClaims(text: string, source: string) {
  const patterns = [
    /\d+(?:[.,]\d+)?\s*(?:%|USD|EUR|TRY|TL|€|\$|₺)/giu,
    /\bv\d+(?:\.\d+)+\b/giu,
    /\b20\d{2}(?:-\d{2}-\d{2})?\b/gu,
    /\b\d+\s*(?:days?|months?|years?|gün|ay|yıl)\b/giu,
  ];
  for (const pattern of patterns)
    for (const claim of text.match(pattern) ?? [])
      if (!source.toLocaleLowerCase().includes(claim.toLocaleLowerCase()))
        throw new Error(
          "A generated price, date, version or numeric promise is not supported by the owner brief/facts. Edit or review it.",
        );
  for (const link of text.match(/https?:\/\/[^\s)\]]+/giu) ?? [])
    if (!source.includes(link.replace(/[.,;!?]+$/, "")))
      throw new Error("AI generated an unapproved link. Edit the content before publishing.");
  if (/\bsk-[A-Za-z0-9_-]{20,}\b/.test(text))
    throw new Error("Generated content resembles a credential and requires owner review.");
}
export function nearDuplicate(a: string, b: string): boolean {
  const words = (s: string) =>
    new Set(
      s
        .toLocaleLowerCase()
        .replace(/https?:\/\/\S+/g, "")
        .replace(/[^\p{L}\p{N}\s]/gu, " ")
        .split(/\s+/)
        .filter(Boolean),
    );
  const x = words(a),
    y = words(b);
  if (!x.size || !y.size) return a.trim() === b.trim();
  const common = [...x].filter((w) => y.has(w)).length;
  return common / (x.size + y.size - common) >= 0.8;
}
