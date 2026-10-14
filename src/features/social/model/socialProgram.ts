import type { CampaignVariant, SocialAgent, SocialMedia, SocialPlatform } from "./social";

export const SOCIAL_PROGRAM_CAPABILITY = "social.programs.v2";
export const PROGRAM_STEPS = ["text", "image", "adaptation", "schedule", "publish"] as const;
export type ProgramStep = (typeof PROGRAM_STEPS)[number];
export type ImageProvider = "automatic" | "codex" | "gemini" | "comfyui" | "openai-api";
export type ProgramSchedule = {
  mode: "interval" | "times" | "frequency";
  timeZone: string;
  startsAt: number;
  endsAt?: number;
  days: number[]; // ISO weekdays, Monday=1
  startTime: string;
  endTime: string;
  times: string[];
  minIntervalMinutes: number;
  maxIntervalMinutes: number;
  frequency: number;
  period: "day" | "week";
};
export type ProgramConfig = {
  name: string;
  projectId: string;
  accountIds: string[];
  brief: {
    topic: string;
    title: string;
    description: string;
    audience: string;
    language: string;
    voice: string;
    cta: string;
    link?: string;
    factIds: string[];
    angles?: string[];
  };
  textAgent?: SocialAgent;
  image: {
    mode: "none" | "existing" | "generate";
    provider: ImageProvider;
    model?: string;
    aspectRatio: "1:1" | "4:5" | "16:9";
    media: SocialMedia[];
  };
  strategy: "unique" | "repeat" | "pool";
  poolCampaignIds: string[];
  approval: { mode: "approved" | "semi" | "automatic"; steps: ProgramStep[] };
  schedule: ProgramSchedule;
  totalPosts: number | null;
  limits: {
    dailyPosts: number;
    dailyGenerations: number;
    totalGenerations: number;
    maxImageGenerations: number;
  };
  youtube?: CampaignVariant["youtube"];
  mediaOverrides?: Record<string, SocialMedia[]>;
};
export type SocialProgram = ProgramConfig & {
  id: string;
  revision: number;
  enabled: boolean;
  cancelled?: boolean;
  reason?: string;
  createdAt: number;
  updatedAt: number;
  executorId: string;
  generationCount: number;
  imageGenerationCount: number;
  generationDay: string;
  dailyGenerationCount: number;
  nextSequence: number;
  nextAt?: number;
  authorization?: { actorId: string; revision: number; signature: string; activatedAt: number };
};
export type ProgramTarget = {
  accountId: string;
  platform: SocialPlatform;
  status:
    | "pending"
    | "generating"
    | "review"
    | "ready"
    | "queued"
    | "succeeded"
    | "failed"
    | "cancelled";
  variant?: CampaignVariant;
  textAgent?: SocialAgent;
  imageProvider?: ImageProvider;
  imageModel?: string;
  imagePrompt?: string;
  approvals: Partial<Record<ProgramStep, string>>;
  generation: {
    attempts: number;
    runId?: string;
    inputSignature?: string;
    startedAt?: number;
    completedAt?: number;
    providerJobId?: string;
    imageProgress?: number;
    transitions: string[];
  };
  campaignId?: string;
  jobId?: string;
  platformId?: string;
  url?: string;
  error?: string;
};
export type SocialOccurrence = {
  settled?: boolean;
  id: string;
  programId: string;
  programRevision: number;
  sequence: number;
  scheduledAt: number;
  originalAt: number;
  revision: number;
  targets: ProgramTarget[];
};
export type ProgramDetail = {
  program: SocialProgram;
  occurrences: SocialOccurrence[];
  nextBefore?: number;
};
export type ImageCapability = {
  provider: Exclude<ImageProvider, "automatic">;
  available: boolean;
  reason: string;
  models: string[];
};
export type ProgramFeatures = {
  capability: typeof SOCIAL_PROGRAM_CAPABILITY;
  executorId: string;
  images: ImageCapability[];
  formats: Record<
    string,
    { formats: string[]; reason?: string; requiresReview: boolean; allowsRepeat: boolean }
  >;
};

export function programApprovalSteps(mode: ProgramConfig["approval"]["mode"]): ProgramStep[] {
  return mode === "approved"
    ? [...PROGRAM_STEPS]
    : mode === "semi"
      ? ["text", "image", "schedule"]
      : [];
}
export function programGeneratesImage(p: ProgramConfig, accountId: string) {
  return p.image.mode === "generate" && p.mediaOverrides?.[accountId] === undefined;
}
export function defaultProgram(projectId = "", now = Date.now()): ProgramConfig {
  return {
    name: "",
    projectId,
    accountIds: [],
    brief: {
      topic: "",
      title: "",
      description: "",
      audience: "",
      language: "tr",
      voice: "",
      cta: "",
      factIds: [],
    },
    image: { mode: "none", provider: "automatic", aspectRatio: "1:1", media: [] },
    strategy: "unique",
    poolCampaignIds: [],
    approval: { mode: "semi", steps: programApprovalSteps("semi") },
    schedule: {
      mode: "times",
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Istanbul",
      startsAt: now,
      days: [1, 2, 3, 4, 5, 6, 7],
      startTime: "09:00",
      endTime: "18:00",
      times: ["09:00"],
      minIntervalMinutes: 120,
      maxIntervalMinutes: 300,
      frequency: 1,
      period: "day",
    },
    totalPosts: 10,
    limits: {
      dailyPosts: 10,
      dailyGenerations: 30,
      totalGenerations: 100,
      maxImageGenerations: 30,
    },
  };
}
