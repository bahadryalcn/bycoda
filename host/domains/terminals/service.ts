import {
  TerminalsListParamsSchema,
  TerminalsCreateParamsSchema,
  TerminalsReadParamsSchema,
  TerminalsWriteParamsSchema,
  TerminalsControlParamsSchema,
  type HostTerminal,
  type HostTerminalList,
  type HostTerminalRead,
} from "../../../src/shared/model/host-contracts/terminals";
import { assertDomainAuthority, type HostDomainContext } from "../context";

type Params = Record<string, unknown>;
const schemas = {
  list: TerminalsListParamsSchema,
  create: TerminalsCreateParamsSchema,
  read: TerminalsReadParamsSchema,
  write: TerminalsWriteParamsSchema,
  interrupt: TerminalsControlParamsSchema,
  close: TerminalsControlParamsSchema,
};
export type TerminalAction = keyof typeof schemas;
export interface TerminalServicePorts {
  project(id: string): Promise<{ id: string; cwd: string }>;
  terminals: {
    list(projectId: string): HostTerminalList;
    create(
      project: { id: string; cwd: string },
      params: Params,
      owner: string,
      authorized: () => boolean | Promise<boolean>,
    ): Promise<HostTerminal>;
    read(projectId: string, params: Params): HostTerminalRead;
    write(projectId: string, params: Params): Promise<{ accepted: true }>;
    interrupt(projectId: string, id: unknown): Promise<{ accepted: true }>;
    remove(projectId: string, id: unknown): Promise<{ closed: true }>;
  };
  activity(projectId: string, terminalId: unknown, closedCwd?: string): Promise<void>;
}

/** Process ownership, creation deduplication and byte bounds stay in HostTerminals. */
export function createTerminalService(ports: TerminalServicePorts) {
  const cursors = new Map<string, number>();
  const states = new Map<string, string>();
  const touch = async (projectId: string, id: unknown, closedCwd?: string) => {
    await ports.activity(projectId, id, closedCwd);
    if (typeof id === "string") {
      const terminal = ports.terminals.list(projectId).terminals.find((entry) => entry.id === id);
      if (terminal) states.set(id, terminal.state);
    }
  };
  const execute = async (
    action: TerminalAction,
    raw: Params,
    context: HostDomainContext,
    options: { legacy?: boolean } = {},
  ) => {
    await assertDomainAuthority(context);
    const params: Params = options.legacy ? raw : schemas[action].parse(raw);
    const project = await ports.project(String(params.projectId ?? ""));
    await assertDomainAuthority(context);
    let result;
    if (action === "list") result = ports.terminals.list(project.id);
    else if (action === "create") {
      if (!context.principalId) throw new Error("Authenticated terminal owner is required");
      result = await ports.terminals.create(
        project,
        params,
        context.principalId,
        context.authorized,
      );
      await touch(project.id, result.id);
    } else if (action === "read") {
      result = ports.terminals.read(project.id, params);
      if (
        result.cursor > (cursors.get(result.terminal.id) ?? 0) ||
        states.get(result.terminal.id) !== result.terminal.state
      ) {
        cursors.set(result.terminal.id, result.cursor);
        await touch(project.id, result.terminal.id);
      }
    } else if (action === "write") {
      result = await ports.terminals.write(project.id, params);
      await touch(project.id, params.id);
    } else if (action === "interrupt")
      result = await ports.terminals.interrupt(project.id, params.id);
    else {
      const cwd = ports.terminals
        .list(project.id)
        .terminals.find((entry) => entry.id === params.id)?.cwd;
      result = await ports.terminals.remove(project.id, params.id);
      if (typeof params.id === "string") {
        cursors.delete(params.id);
        states.delete(params.id);
        await touch(project.id, params.id, cwd);
      }
    }
    await assertDomainAuthority(context);
    return result;
  };
  const operation =
    (action: TerminalAction) =>
    (params: Params, context: HostDomainContext, options?: { legacy?: boolean }) =>
      execute(action, params, context, options);
  return {
    list: operation("list"),
    create: operation("create"),
    read: operation("read"),
    write: operation("write"),
    interrupt: operation("interrupt"),
    close: operation("close"),
  };
}
