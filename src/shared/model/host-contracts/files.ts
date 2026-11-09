import { z } from "zod";
import { IdentifierSchema, SafeCounterSchema } from "./schemas";

// The filesystem owner enforces path/query/content limits in UTF-16/UTF-8 as
// appropriate. JSON Schema maxLength counts Unicode scalars and is not equivalent.
const path = z.string();
const project = { projectId: IdentifierSchema, cwd: path.optional() };
export const FilesReadParamsSchema = z.strictObject({ ...project, path });
export const FilesListParamsSchema = FilesReadParamsSchema;
export const FilesIndexParamsSchema = z.strictObject(project);
export const FilesSearchParamsSchema = z.strictObject({ ...project, query: z.string() });
export const FilesSearchContentParamsSchema = z.strictObject({
  ...project,
  query: z.string(),
  caseSensitive: z.boolean().optional(),
  wholeWord: z.boolean().optional(),
  regex: z.boolean().optional(),
  include: z.string().optional(),
  exclude: z.string().optional(),
});
export const FilesCreateParamsSchema = z.strictObject({
  ...project,
  parent: path,
  name: z.string(),
  isDir: z.boolean(),
});
export const FilesWriteParamsSchema = z.strictObject({
  ...project,
  path,
  expected: z.string(),
  content: z.string(),
});
export const HostFileEntrySchema = z.strictObject({
  name: z.string(),
  path,
  isDir: z.boolean(),
  ignored: z.boolean(),
});
export const HostFileListSchema = z.array(HostFileEntrySchema);
export const HostContentSearchResultSchema = z.strictObject({
  matches: z.array(
    z.strictObject({
      path,
      relative: path,
      line: SafeCounterSchema.min(1),
      column: SafeCounterSchema.min(1),
      preview: z.string(),
    }),
  ),
  truncated: z.boolean(),
});
export type HostFileEntry = z.infer<typeof HostFileEntrySchema>;
export type HostContentSearchResult = z.infer<typeof HostContentSearchResultSchema>;
