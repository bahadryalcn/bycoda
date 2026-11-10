import { z } from "zod";
import { SessionProviderSchema, SessionRuntimeModeSchema, ModelSettingsSchema } from "./session-commands";

const text = (max: number) => z.string().min(1).max(max);

/** Largest distance a one-time automation may be scheduled ahead. */
export const QUICK_AUTOMATION_MAX_AHEAD_MS = 366 * 24 * 60 * 60 * 1000;

/** `once` carries an absolute `runAt` (epoch ms) and nothing else carries one. */
export const quickAutomationActionSchema = z
  .strictObject({
    kind: z.literal("automation"),
    projectId: text(200),
    name: text(200).refine((value) => !!value.trim()),
    prompt: text(16000).refine((value) => !!value.trim() && !value.includes("\0")),
    harness: SessionProviderSchema,
    model: text(200).refine((value) => !!value.trim()),
    modelSettings: ModelSettingsSchema,
    runtimeMode: SessionRuntimeModeSchema,
    scheduleKind: z.enum(["hourly", "daily", "weekdays", "weekly", "once"]),
    runAt: z.number().int().positive().optional(),
    minute: z.number().int().min(0).max(59),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    dayOfWeek: z.number().int().min(0).max(6),
    maxRunMinutes: z.number().int().min(0).max(10080),
    maxRunsPerDay: z.number().int().min(0).max(1000),
    isolate: z.boolean(),
    enabled: z.boolean(),
  })
  .refine((action) => (action.scheduleKind === "once") === (action.runAt !== undefined));
