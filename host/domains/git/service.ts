import { z } from "zod";
import * as dto from "../../../src/shared/model/host-contracts/git";
import { assertDomainAuthority, type HostDomainContext } from "../context";

type Scope = "local" | "exclusive";
/** Index and commit writes: they never rewrite working files, so agents can keep running. */
const LOCAL_ACTIONS: ReadonlySet<string> = new Set([
  "stage",
  "unstage",
  "stageFiles",
  "unstageFiles",
  "stageAll",
  "unstageAll",
  "stageContents",
  "commit",
]);
/** Remote delivery also leaves working files alone, but keeps the exclusive Git lane. */
const PUBLISH_ACTIONS: ReadonlySet<string> = new Set(["push", "createPr"]);
export interface HostGitServicePorts {
  project(id: string): Promise<{ id: string; cwd: string }>;
  resolveWorktree(root: string, requested: unknown): Promise<string>;
  withIdleProject<T>(id: string, work: () => Promise<T>): Promise<T>;
  withStableCheckout<T>(id: string, work: () => Promise<T>): Promise<T>;
  serializeMutation<T>(cwd: string, work: () => Promise<T>, scope: Scope): Promise<T>;
  startActivity(cwd: string): Promise<() => Promise<void>>;
  invalidateRoots(): void;
  diff(cwd: string): Promise<string>;
  branches(cwd: string): Promise<dto.GitBranches>;
  switch(cwd: string, branch: unknown, remote?: unknown): Promise<dto.GitBranches>;
  createBranch(cwd: string, branch: unknown): Promise<dto.GitBranches>;
  worktrees(cwd: string): Promise<dto.GitWorktrees>;
  worktreeCreate(
    root: string,
    branch: unknown,
    base: unknown,
    existing: unknown,
    source: string,
  ): Promise<dto.GitWorktree>;
  index(cwd: string): Promise<dto.GitIndex>;
  generateText?(
    cwd: string,
    params: z.output<typeof dto.GitGenerateTextParamsSchema>,
    authorize: () => Promise<void>,
  ): Promise<z.output<typeof dto.GitGenerateTextResultSchema>>;
  fileDiff(cwd: string, path: unknown, staged: boolean): Promise<dto.GitFileDiff>;
  action(
    cwd: string,
    action: unknown,
    path?: unknown,
    message?: unknown,
    content?: unknown,
    expectedOriginal?: unknown,
  ): Promise<string | void>;
}
type Options = { legacy?: boolean; beforeEffect?: (cwd: string) => Promise<void> };
export function createHostGitService(ports: HostGitServicePorts) {
  function parse<S extends z.ZodObject>(schema: S, raw: unknown, options: Options): z.output<S> {
    return (options.legacy ? schema.strip() : schema).parse(raw) as z.output<S>;
  }
  async function resolve(params: dto.GitReadParams, context: HostDomainContext) {
    const project = await ports.project(params.projectId);
    const cwd = await ports.resolveWorktree(project.cwd, params.cwd);
    await assertDomainAuthority(context);
    return { project, cwd };
  }
  async function read<P extends dto.GitReadParams, R>(
    schema: z.ZodType<P>,
    raw: unknown,
    context: HostDomainContext,
    options: Options,
    operation: (cwd: string, params: P, root: string) => Promise<R>,
  ) {
    await assertDomainAuthority(context);
    const params = parse(schema as z.ZodObject, raw, options) as P;
    const { project, cwd } = await resolve(params, context);
    const result = await operation(cwd, params, project.cwd);
    await assertDomainAuthority(context);
    return result;
  }
  async function mutate<P extends dto.GitReadParams, R>(
    schema: z.ZodType<P>,
    raw: unknown,
    context: HostDomainContext,
    options: Options,
    operation: (cwd: string, params: P, root: string) => Promise<R>,
    action = false,
  ) {
    await assertDomainAuthority(context);
    const params = parse(schema as z.ZodObject, raw, options) as P;
    const first = await resolve(params, context);
    const release = action ? await ports.startActivity(first.cwd) : undefined;
    try {
      const name = action ? (params as unknown as dto.GitActionParams).action : undefined;
      const besideAgents = !!name && (LOCAL_ACTIONS.has(name) || PUBLISH_ACTIONS.has(name));
      const run = async () => {
        await assertDomainAuthority(context);
        const current = await resolve(params, context);
        const effect = async () => {
          await assertDomainAuthority(context);
          const latest = await resolve(params, context);
          if (latest.cwd !== current.cwd || latest.project.cwd !== current.project.cwd)
            throw new Error("Project checkout changed while Git mutation was queued");
          await options.beforeEffect?.(latest.cwd);
          await assertDomainAuthority(context);
          return operation(latest.cwd, params, latest.project.cwd);
        };
        return ports.serializeMutation(
          current.cwd,
          // Checked inside the queue so a branch switch that got ahead of this work still refuses it.
          besideAgents ? () => ports.withStableCheckout(current.project.id, effect) : effect,
          name && LOCAL_ACTIONS.has(name) ? "local" : "exclusive",
        );
      };
      const result = besideAgents
        ? await run()
        : await ports.withIdleProject(first.project.id, run);
      await assertDomainAuthority(context);
      return result;
    } finally {
      await release?.();
    }
  }
  return {
    /** Internal composition only: a fixed operation supplied by the Host, never
     * a model command. Shares checkout resolution, idle and exclusive mutation gates. */
    managedAction: <T>(
      p: unknown,
      c: HostDomainContext,
      operation: (cwd: string) => Promise<T>,
      o: Options = {},
    ) => mutate(dto.GitReadParamsSchema, p, c, o, (cwd) => operation(cwd), true),
    diff: (p: unknown, c: HostDomainContext, o: Options = {}) =>
      read(dto.GitReadParamsSchema, p, c, o, (cwd) => ports.diff(cwd)),
    branches: (p: unknown, c: HostDomainContext, o: Options = {}) =>
      read(dto.GitReadParamsSchema, p, c, o, (cwd) => ports.branches(cwd)),
    worktrees: (p: unknown, c: HostDomainContext, o: Options = {}) =>
      read(dto.GitReadParamsSchema, p, c, o, (_cwd, _params, root) => ports.worktrees(root)),
    index: (p: unknown, c: HostDomainContext, o: Options = {}) =>
      read(dto.GitReadParamsSchema, p, c, o, (cwd) => ports.index(cwd)),
    generateText: (p: unknown, c: HostDomainContext, o: Options = {}) =>
      read(dto.GitGenerateTextParamsSchema, p, c, o, (cwd, params) => {
        if (!ports.generateText) throw new Error("Git text generation is unavailable on this Host");
        return ports.generateText(cwd, params, () => assertDomainAuthority(c));
      }),
    fileDiff: (p: unknown, c: HostDomainContext, o: Options = {}) =>
      read(dto.GitFileDiffParamsSchema, p, c, o, (cwd, params) =>
        ports.fileDiff(cwd, params.path, params.staged === true),
      ),
    switch: (p: unknown, c: HostDomainContext, o: Options = {}) =>
      mutate(dto.GitSwitchParamsSchema, p, c, o, (cwd, params) =>
        ports.switch(cwd, params.branch, params.remote),
      ),
    createBranch: (p: unknown, c: HostDomainContext, o: Options = {}) =>
      mutate(dto.GitCreateBranchParamsSchema, p, c, o, (cwd, params) =>
        ports.createBranch(cwd, params.branch),
      ),
    worktreeCreate: (p: unknown, c: HostDomainContext, o: Options = {}) =>
      mutate(dto.GitWorktreeCreateParamsSchema, p, c, o, async (cwd, params, root) => {
        const result = await ports.worktreeCreate(
          root,
          params.branch,
          params.base,
          params.existing,
          cwd,
        );
        ports.invalidateRoots();
        return result;
      }),
    action: (p: unknown, c: HostDomainContext, o: Options = {}) =>
      mutate(
        dto.GitActionParamsSchema,
        p,
        c,
        o,
        async (cwd, params) =>
          (await ports.action(
            cwd,
            params.action,
            params.path,
            params.message,
            params.content,
            params.expectedOriginal,
          )) ?? null,
        true,
      ),
  };
}
