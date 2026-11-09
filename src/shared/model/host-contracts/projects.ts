import { z } from "zod";
export const ProjectAppearanceSchema = z.strictObject({
  color: z.string().optional(),
  icon: z.strictObject({ path: z.string(), highlight: z.string() }).optional(),
  logo: z.string().optional(),
});
export const HostProjectSchema = z.strictObject({
  id: z.string(),
  cwd: z.string(),
  name: z.string(),
  appearance: ProjectAppearanceSchema.optional(),
});
const layout = z.strictObject({
  folders: z.array(
    z.strictObject({
      id: z.string(),
      name: z.string(),
      sessionIds: z.array(z.string()),
      collapsed: z.boolean(),
      ordered: z.boolean().optional(),
      parentId: z.string().optional(),
      pinned: z.boolean().optional(),
    }),
  ),
  order: z.strictObject({
    loose: z.array(z.string()).optional(),
    pinned: z.array(z.string()).optional(),
  }),
});
export const ProjectDirectorySchema = z.strictObject({
  version: z.literal(1),
  privacyReady: z.boolean(),
  projects: z.array(
    HostProjectSchema.extend({
      groupId: z.string().optional(),
      registered: z.boolean(),
      sessionLayout: layout.optional(),
    }),
  ),
  groups: z.array(
    z.strictObject({
      id: z.string(),
      name: z.string(),
      color: z.string().optional(),
      collapsed: z.boolean().optional(),
      appearance: ProjectAppearanceSchema.optional(),
    }),
  ),
});
export const HostDirectorySchema = z.strictObject({
  path: z.string(),
  parent: z.string().nullable(),
  home: z.string().optional(),
  roots: z.array(z.strictObject({ name: z.string(), path: z.string() })).optional(),
  entries: z.array(z.strictObject({ name: z.string(), path: z.string() })),
});
export const ProjectsEmptyParamsSchema = z.strictObject({});
export const ProjectsBrowseParamsSchema = z.strictObject({ path: z.string().optional() });
export const ProjectsCreateDirectoryParamsSchema = z.strictObject({
  path: z.string(),
  name: z.string(),
});
export const ProjectsOpenParamsSchema = z.strictObject({ cwd: z.string() });
export type HostProject = z.infer<typeof HostProjectSchema>;
export type HostDirectory = z.infer<typeof HostDirectorySchema>;
export type HostProjectDirectory = z.infer<typeof ProjectDirectorySchema>;
