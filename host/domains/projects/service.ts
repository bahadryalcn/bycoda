import * as dto from "../../../src/shared/model/host-contracts/projects";
import { HostDomainRefusalError, assertDomainAuthority, type HostDomainContext } from "../context";
import {
  ProjectsCloneParamsSchema,
  ProjectsCloneProgressParamsSchema,
  cloneProgress,
  cloneRepository,
  runGitClone,
  type PathExists,
  type SpawnProcess,
} from "./clone";

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
  /** Process launch and existence check for `git clone`; domains never import platform modules. */
  clonePorts?: { spawn: SpawnProcess; exists: PathExists };
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
    async clone(raw: unknown, context: HostDomainContext, options: Options = {}) {
      await assertDomainAuthority(context);
      const params = (
        options.legacy ? ProjectsCloneParamsSchema.strip() : ProjectsCloneParamsSchema
      ).parse(raw);
      // Same folder vetting as projects.browse: absolute, existing directory.
      const parent = await ports().browse(params.parentPath);
      await assertDomainAuthority(context);
      const runtime = () => {
        if (!dependencies.clonePorts) throw new Error("Project cloning is unavailable");
        return dependencies.clonePorts;
      };
      // The URL and destination are validated before the ports are needed, so an invalid
      // request fails with its own message on any Host.
      const result = await cloneRepository(
        params,
        parent.path,
        (url, dest, options) => runGitClone(url, dest, { ...options, spawn: runtime().spawn }),
        (path) => runtime().exists(path),
      );
      await assertDomainAuthority(context);
      return result;
    },
    async cloneProgress(raw: unknown, context: HostDomainContext) {
      await assertDomainAuthority(context);
      const params = ProjectsCloneProgressParamsSchema.strip().parse(raw);
      return { progress: cloneProgress(params.operationId) };
    },
    async open(raw: unknown, context: HostDomainContext, options: Options = {}) {
      await assertDomainAuthority(context);
      const params = (
        options.legacy ? dto.ProjectsOpenParamsSchema.strip() : dto.ProjectsOpenParamsSchema
      ).parse(raw);
      let result;
      try {
        result = await ports().open(params.cwd, async () => {
          await assertDomainAuthority(context);
          return true;
        });
      } catch (error) {
        // The folder is checked before anything is recorded: a definitive refusal
        // clients can stop repeating, not an unknown outcome to reconcile.
        if (isMissingFolder(error))
          throw new HostDomainRefusalError(
            "PROJECT_FOLDER_MISSING",
            "validation",
            false,
            `Project folder not found on this machine: ${params.cwd}`,
            { cause: error },
          );
        throw error;
      }
      await assertDomainAuthority(context);
      return result;
    },
  };
}

function isMissingFolder(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR")
  );
}
