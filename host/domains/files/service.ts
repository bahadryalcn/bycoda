import {
  FilesReadParamsSchema,
  FilesListParamsSchema,
  FilesIndexParamsSchema,
  FilesSearchParamsSchema,
  FilesSearchContentParamsSchema,
  FilesCreateParamsSchema,
  FilesWriteParamsSchema,
  type HostFileEntry,
  type HostContentSearchResult,
} from "../../../src/shared/model/host-contracts/files";
import { assertDomainAuthority, type HostDomainContext } from "../context";

type Params = Record<string, unknown>;
export interface FileServicePorts {
  project(id: string): Promise<{ cwd: string }>;
  resolveWorkspace(root: string, requested: unknown): Promise<string>;
  activity(cwd: string, kind: "editor", action: string): Promise<() => Promise<void>>;
  files: {
    read(cwd: string, path: unknown): Promise<string>;
    list(cwd: string, path: unknown): Promise<HostFileEntry[]>;
    index(cwd: string): Promise<string[]>;
    search(cwd: string, query: unknown): Promise<HostFileEntry[]>;
    searchContent(
      cwd: string,
      params: unknown,
      signal?: AbortSignal,
    ): Promise<HostContentSearchResult>;
    /** Existing filesystem owner rechecks this grant inside its mutation queue. */
    create(
      cwd: string,
      parent: unknown,
      name: unknown,
      isDir: unknown,
      authorized: () => Promise<boolean>,
    ): Promise<string>;
    write(
      cwd: string,
      path: unknown,
      expected: unknown,
      content: unknown,
      authorized: () => Promise<boolean>,
    ): Promise<void>;
  };
}
const schemas = {
  read: FilesReadParamsSchema,
  list: FilesListParamsSchema,
  index: FilesIndexParamsSchema,
  search: FilesSearchParamsSchema,
  searchContent: FilesSearchContentParamsSchema,
  create: FilesCreateParamsSchema,
  write: FilesWriteParamsSchema,
};
type Action = keyof typeof schemas;
/** Routing/admission only. Path confinement, CAS and serialization stay in the filesystem owner. */
export function createFileService(ports: FileServicePorts) {
  const execute = async (
    action: Action,
    raw: Params,
    context: HostDomainContext,
    options: { legacy?: boolean } = {},
  ) => {
    await assertDomainAuthority(context);
    const params: Params = options.legacy ? raw : schemas[action].parse(raw);
    const project = await ports.project(String(params.projectId ?? ""));
    await assertDomainAuthority(context);
    const cwd = await ports.resolveWorkspace(project.cwd, params.cwd);
    await assertDomainAuthority(context);
    if (action === "create" || action === "write") {
      const release = await ports.activity(cwd, "editor", `files.${action}`);
      try {
        await assertDomainAuthority(context);
        const result =
          action === "create"
            ? await ports.files.create(cwd, params.parent, params.name, params.isDir, () =>
                context.authorized(),
              )
            : ((await ports.files.write(cwd, params.path, params.expected, params.content, () =>
                context.authorized(),
              )) ?? null);
        await assertDomainAuthority(context);
        return result;
      } finally {
        await release();
      }
    }
    const result =
      action === "read"
        ? await ports.files.read(cwd, params.path)
        : action === "list"
          ? await ports.files.list(cwd, params.path)
          : action === "index"
            ? await ports.files.index(cwd)
            : action === "search"
              ? await ports.files.search(cwd, params.query)
              : await ports.files.searchContent(cwd, params, context.signal);
    await assertDomainAuthority(context);
    return result;
  };
  return {
    read: (params: Params, context: HostDomainContext, options?: { legacy?: boolean }) =>
      execute("read", params, context, options),
    list: (params: Params, context: HostDomainContext, options?: { legacy?: boolean }) =>
      execute("list", params, context, options),
    index: (params: Params, context: HostDomainContext, options?: { legacy?: boolean }) =>
      execute("index", params, context, options),
    search: (params: Params, context: HostDomainContext, options?: { legacy?: boolean }) =>
      execute("search", params, context, options),
    searchContent: (params: Params, context: HostDomainContext, options?: { legacy?: boolean }) =>
      execute("searchContent", params, context, options),
    create: (params: Params, context: HostDomainContext, options?: { legacy?: boolean }) =>
      execute("create", params, context, options),
    write: (params: Params, context: HostDomainContext, options?: { legacy?: boolean }) =>
      execute("write", params, context, options),
  };
}
