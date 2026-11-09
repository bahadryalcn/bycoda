import * as dto from "../../../src/shared/model/host-contracts/projects";
import { assertDomainAuthority, type HostDomainContext } from "../context";

export type ProjectsReadOptions = { signal?: AbortSignal };
export interface ProjectDirectoryPorts {
  directory(): dto.HostProjectDirectory | Promise<dto.HostProjectDirectory>;
  browse(path: unknown): Promise<dto.HostDirectory>;
  createDirectory(
    path: unknown,
    name: unknown,
    authorize: () => Promise<void>,
  ): Promise<dto.HostDirectory>;
  /** Composition holds this callback through the actual store mutation. */
  open(cwd: string, authorize: () => Promise<boolean>): Promise<dto.HostProject>;
}

/** The store remains authoritative; transports share this read operation. */
export function createProjectsService<Project>(dependencies: {
  list: (options: ProjectsReadOptions) => readonly Project[] | Promise<readonly Project[]>;
  directoryPorts?: ProjectDirectoryPorts;
}) {
  const ports = () => {
    if (!dependencies.directoryPorts) throw new Error("Project directory access is unavailable");
    return dependencies.directoryPorts;
  };
  type Options = { legacy?: boolean };
  return {
    async list(options: ProjectsReadOptions = {}, context?: HostDomainContext): Promise<Project[]> {
      if (context) await assertDomainAuthority(context);
      options.signal?.throwIfAborted();
      const projects = await dependencies.list(options);
      if (context) await assertDomainAuthority(context);
      options.signal?.throwIfAborted();
      // Do not expose the store's collection for callers to reorder in place.
      return [...projects];
    },
    async directory(raw: unknown, context: HostDomainContext, options: Options = {}) {
      await assertDomainAuthority(context);
      (options.legacy
        ? dto.ProjectsEmptyParamsSchema.strip()
        : dto.ProjectsEmptyParamsSchema
      ).parse(raw);
      const result = await ports().directory();
      await assertDomainAuthority(context);
      return result;
    },
    async browse(raw: unknown, context: HostDomainContext, options: Options = {}) {
      await assertDomainAuthority(context);
      const params = (
        options.legacy ? dto.ProjectsBrowseParamsSchema.strip() : dto.ProjectsBrowseParamsSchema
      ).parse(raw);
      const result = await ports().browse(params.path);
      await assertDomainAuthority(context);
      return result;
    },
    async createDirectory(raw: unknown, context: HostDomainContext, options: Options = {}) {
      await assertDomainAuthority(context);
      const params = (
        options.legacy
          ? dto.ProjectsCreateDirectoryParamsSchema.strip()
          : dto.ProjectsCreateDirectoryParamsSchema
      ).parse(raw);
      const result = await ports().createDirectory(params.path, params.name, () =>
        assertDomainAuthority(context),
      );
      await assertDomainAuthority(context);
      return result;
    },
    async open(raw: unknown, context: HostDomainContext, options: Options = {}) {
      await assertDomainAuthority(context);
      const params = (
        options.legacy ? dto.ProjectsOpenParamsSchema.strip() : dto.ProjectsOpenParamsSchema
      ).parse(raw);
      const result = await ports().open(params.cwd, async () => {
        await assertDomainAuthority(context);
        return true;
      });
      await assertDomainAuthority(context);
      return result;
    },
  };
}
