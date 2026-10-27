import { z } from "zod";
import { SafeCounterSchema } from "./schemas";

// Storage owns ID syntax, UTF8 limits, tag normalization, slug policy and CAS.
const fields = {
  id: z.string(),
  title: z.string(),
  body: z.string(),
  tags: z.array(z.string()),
  sourceSessionId: z.string().optional(),
  sourceCwd: z.string().optional(),
};
export const HostNoteSchema = z.strictObject({
  ...fields,
  slug: z.string(),
  slugPending: z.boolean(),
  createdAt: SafeCounterSchema,
  updatedAt: SafeCounterSchema,
  contentUpdatedAt: SafeCounterSchema.optional(),
});
export type HostNote = z.infer<typeof HostNoteSchema>;
export const NotesGetResultSchema = HostNoteSchema.nullable();
export const HostNoteUpsertSchema = z.strictObject({
  ...fields,
  expectedUpdatedAt: SafeCounterSchema.optional(),
  finalizeSlug: z.boolean().optional(),
});
export const NotesListParamsSchema = z.strictObject({
  projectId: z.string().optional(),
  sessionId: z.string().optional(),
});
export const NotesGetParamsSchema = NotesListParamsSchema.extend({ id: z.string() });
export const NotesUpsertParamsSchema = z.strictObject({
  note: HostNoteUpsertSchema,
  expectedUpdatedAt: SafeCounterSchema.optional(),
});
export const NotesDeleteParamsSchema = z.strictObject({
  id: z.string(),
  expectedUpdatedAt: SafeCounterSchema.optional(),
});
export const NotesListResultSchema = z.strictObject({
  notes: z.array(HostNoteSchema.extend({ preview: z.literal(true) })),
  total: SafeCounterSchema,
});
export const NotesDeleteResultSchema = z.strictObject({ deleted: z.literal(true) });
export type HostNotesList = z.infer<typeof NotesListResultSchema>;
