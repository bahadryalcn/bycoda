import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { request } from "node:http";
import { HostEngine } from "./engine";
import { HostStore } from "./store";
import { createHostServer } from "./server";
import { BrowserRuntime } from "./browser-runtime";
import { DeviceHost } from "./device-host";
import * as expoGo from "./expo-go";
import { RuntimeLogsService } from "./runtime-logs";
import { HostChildBackend } from "./child-backend";
import { HostTasks } from "./tasks";
import { HostNotes } from "./host-notes";
import { configureChildBackend } from "../src/integrations/harness/core/child";
import type { SendTurnInput } from "../src/integrations/harness/core/types";
import type { RemoteProvider } from "../src/features/connections/model/protocol";

const modelProbe = vi.hoisted(() => vi.fn());
vi.mock("../src/integrations/harness/providers/codex/codexCatalog", () => ({
  discoverCodexModels: modelProbe,
  refreshCodexCatalog: async () => {},
}));
// Catalog tests point the host at a stand-in provider CLI.
const binaries: { codex?: string } = {};
configureChildBackend(new HostChildBackend(binaries));

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

describe("scoped Conversation Tools RPC", () => {
  it("routes preview jobs through scoped RPC and rejects foreign ownership and protected input", async () => {
    const spies = [
      vi.spyOn(DeviceHost.prototype, "preflight").mockResolvedValue({ device: { id: "sim", name: "iPhone", platform: "ios", version: "27", booted: true, physical: false }, status: { running: true, installed: true, agentInstalled: true, platform: "darwin", platforms: [] }, devices: [], errors: [], checks: { sdk: true, device: true, tools: true, agentControl: true } }),
      vi.spyOn(DeviceHost.prototype, "status").mockResolvedValue({ running: true, installed: true, agentInstalled: true, platform: "darwin", platforms: [] }),
      vi.spyOn(DeviceHost.prototype, "prepareExpo").mockResolvedValue({ app: "host.exp.Exponent", version: "57.0.9", installed: false }),
      vi.spyOn(DeviceHost.prototype, "openExpo").mockResolvedValue(undefined),
      vi.spyOn(DeviceHost.prototype, "action").mockResolvedValue('{"success":true,"data":{"nodes":[]}}'),
      vi.spyOn(DeviceHost.prototype, "capture").mockResolvedValue({ mime: "image/png", base64: "aGVsbG8=", capturedAt: "now" }),
      vi.spyOn(expoGo, "expoManifest").mockResolvedValue({ sdkVersion: "57.0.0" }),
    ];
    try {
      const s = await setup();
      const input = { requestId: "r", deviceId: "sim", url: "exp://localhost:8081", previewOwner: "session-a" };
      const started = (await s.call("devices.preview", input)).value.result;
      expect(started.id).toBeTruthy();
      await vi.waitFor(async () => expect((await s.call("devices.preview.status", { id: started.id, previewOwner: "session-a" })).value.result.state).toBe("ready"));
      expect((await s.call("devices.preview", input)).value.result.id).toBe(started.id);
      expect((await s.call("devices.preview.status", { id: started.id, previewOwner: "session-b", includeFrame: true })).value.error).toContain("PREVIEW_SCOPE_MISMATCH");
      expect((await s.call("devices.preview", { ...input, approved: true })).value.error).toContain("protected");
      expect((await s.call("devices.preview", { ...input, projectId: "foreign-project" })).value.error).toBeTruthy();
    } finally { spies.forEach((spy) => spy.mockRestore()); }
  });
  async function sessionTools() {
    const s = await setup();
    const created = s.engine.command({
      type: "create",
      commandId: crypto.randomUUID(),
      projectId: s.project.id,
      harness: "codex",
      model: "gpt",
      runtimeMode: "supervised",
    });
    const grant = (await s.call("conversation.access.issue", { sessionId: created.sessionId }))
      .value.result;
    const tool = (action: string, input: Record<string, unknown> = {}) =>
      s.call("conversation.tools.call", { action, input }, grant.token);
    return { ...s, created, grant, tool };
  }
  it.each([
    ["ui.tools.open", { tab: "devices", placement: "right", machineId: "mac" }],
    ["ui.workspace.open", { view: "settings", section: "connections" }],
  ])(
    "forwards %s with host/project/session identity and waits for the desktop acknowledgement",
    async (action, input) => {
      const s = await sessionTools();
      await s.call("conversation.desktop.take");
      const pending = s.tool(action, input);
      let requests: any[] = [];
      for (let i = 0; i < 20 && !requests.length; i++) {
        await new Promise((done) => setTimeout(done, 10));
        requests = (await s.call("conversation.desktop.take")).value.result;
      }
      expect(requests[0]).toMatchObject({
        action,
        environmentId: s.store.environmentId,
        cwd: s.project.cwd,
        sessionId: s.created.sessionId,
        input,
      });
      const state =
        action === "ui.workspace.open"
          ? { view: "settings", section: "connections", mounted: true }
          : {
              open: true,
              placement: "right",
              panels: [{ id: "pane", tab: "devices", machine: "machine:mac", mounted: true }],
            };
      await s.call("conversation.desktop.finish", { id: requests[0].id, result: state });
      expect((await pending).value.result).toEqual(state);
      expect((await s.tool("ui.tools.open", { sessionId: "foreign" })).value.error).toContain(
        "protected",
      );
      expect((await s.tool("ui.tools.place", { placement: "diagonal" })).value.error).toContain(
        "Invalid",
      );
    },
  );
  it("separates read-only log tokens, conversation grants and native owner operations", async () => {
    const s = await sessionTools();
    expect((await s.tool("tools.list")).value.result).toMatchObject({ projectId: s.project.id });
    expect((await s.tool("tasks.list", { projectId: "foreign" })).value.error).toContain(
      "protected",
    );
    expect((await s.call("projects.list", {}, s.grant.token)).value.error).toContain(
      "Conversation Tools",
    );
    expect((await s.call("conversation.desktop.take", {}, s.grant.token)).value.error).toContain(
      "Conversation Tools",
    );
    const logs = (await s.call("runtimeLogs.access.issue", { sessionId: s.created.sessionId }))
      .value.result;
    expect(
      (await s.call("conversation.tools.call", { action: "tasks.list", input: {} }, logs.token))
        .value.error,
    ).toContain("only permit reading");
    expect(
      (await s.call("conversation.tools.call", { action: "tasks.list", input: {} })).value.error,
    ).toContain("scoped");
    s.store.revokeDevice(s.first.id);
    expect((await s.tool("tasks.list")).status).toBe(401);
  });
  it("reads other project sessions without approval and refuses cross-project reads or sends", async () => {
    const s = await sessionTools();
    const create = (projectId: string) =>
      s.engine.command({
        type: "create",
        commandId: crypto.randomUUID(),
        projectId,
        harness: "codex",
        model: "gpt",
        runtimeMode: "supervised",
      });
    const target = create(s.project.id);
    const foreignProject = s.store.addProject(join(s.project.cwd, "foreign"), "Foreign");
    const foreign = create(foreignProject.id);
    const listed = (await s.tool("sessions.list")).value.result.sessions;
    expect(listed.some((session: { id: string }) => session.id === target.sessionId)).toBe(true);
    expect(listed.some((session: { id: string }) => session.id === foreign.sessionId)).toBe(false);
    expect(
      (await s.tool("sessions.read", { sessionId: target.sessionId })).value.result,
    ).toMatchObject({ sessionId: target.sessionId, turns: [], busy: false });
    expect((await s.tool("sessions.read", { sessionId: foreign.sessionId })).value.error).toContain(
      "another project",
    );
    expect(
      (await s.tool("sessions.send", { sessionId: target.sessionId, prompt: "send" })).value.error,
    ).toContain("Unsupported");
  });
  it("routes Notes, Automations and Inbox through the scoped application APIs", async () => {
    const s = await sessionTools();
    const noteRead = vi.spyOn(HostNotes.prototype, "get").mockReturnValue({
      id: "note",
      slug: "note",
      title: "Plan",
      body: "Text",
      tags: [],
      sourceCwd: s.project.cwd,
      slugPending: false,
      createdAt: 1,
      updatedAt: 1,
    });
    try {
      expect((await s.tool("notes.read", { id: "note" })).value.result.title).toBe("Plan");
      expect(noteRead).toHaveBeenCalledWith("note", s.project.cwd);
    } finally {
      noteRead.mockRestore();
    }
    const created = (
      await s.tool("automations.create", {
        automationId: "daily",
        name: "Daily",
        prompt: "Inspect this project",
        scheduleKind: "daily",
        enabled: false,
      })
    ).value.result;
    expect(created).toMatchObject({
      projectId: s.project.id,
      runtimeMode: "supervised",
      enabled: false,
    });
    expect(
      (await s.tool("automations.list")).value.result.items.map((entry: any) => entry.id),
    ).toEqual(["daily"]);
    expect(
      (
        await s.tool("automations.update", {
          automationId: "daily",
          expectedUpdatedAt: created.updatedAt,
          runtimeMode: "full-access",
        })
      ).value.error,
    ).toContain("protected");
    expect((await s.tool("inbox.list")).value.result.items).toEqual([]);
    expect((await s.tool("inbox.providers.status")).value.result.available).toBe(false);
    expect(
      (
        await s.tool("inbox.comment", {
          requestId: "send",
          item: { provider: "github", kind: "issue", number: 1, repo: "owner/project" },
          body: "comment",
          confirm: "SEND_COMMENT",
        })
      ).value.error,
    ).toContain("protected");
  });
  it("filters tasks and rejects cross-project recovery, completion, and changes to its own task", async () => {
    const s = await sessionTools();
    const other = s.store.addProject(join(s.project.cwd, "other"), "Other");
    const input = {
      title: "Task",
      prompt: "Fix the issue",
      harness: "codex",
      model: "gpt",
      modelSettings: {},
      runtimeMode: "supervised",
      maxRunMinutes: 0,
      isolate: false,
      review: false,
      status: "todo",
    };
    const own = (
      await s.call("tasks.save", { task: { ...input, id: "own-task", projectId: s.project.id } })
    ).value.result;
    expect(own.id).toBe("own-task");
    await s.call("tasks.save", { task: { ...input, id: "foreign-task", projectId: other.id } });
    expect((await s.tool("tasks.list")).value.result.map((task: any) => task.id)).toEqual([
      "own-task",
    ]);
    expect((await s.tool("tasks.start", { taskId: "foreign-task" })).value.error).toContain(
      "not in this project",
    );
    expect((await s.tool("tasks.retry", { taskId: "own-task" })).value.error).toContain("blocked");
    expect((await s.tool("tasks.move", { taskId: "own-task", to: "done" })).value.error).toContain(
      "Unsupported",
    );
    const spy = vi
      .spyOn(HostTasks.prototype, "list")
      .mockReturnValue([{ ...own, sessionId: s.created.sessionId }]);
    try {
      expect((await s.tool("tasks.start", { taskId: "own-task" })).value.error).toContain(
        "own active task",
      );
      expect(
        (await s.tool("tasks.session.read", { taskId: "own-task" })).value.result,
      ).toMatchObject({
        sessionId: s.created.sessionId,
        status: "idle",
        totalBlocks: 0,
        blocks: [],
      });
    } finally {
      spy.mockRestore();
    }
    expect(
      (
        await s.tool("tasks.update", {
          taskId: "own-task",
          prompt: "New explicit repair instructions",
        })
      ).value.result.prompt,
    ).toBe("New explicit repair instructions");
  });
  it("relays exact Mac targets and terminal bytes only to the claiming owner, with no host fallback", async () => {
    const s = await sessionTools();
    await s.call("conversation.desktop.take");
    const pending = s.tool("devices.boot", { machineId: "mac", deviceId: "ios" });
    let requests: any[] = [];
    for (let i = 0; i < 20 && !requests.length; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      requests = (await s.call("conversation.desktop.take")).value.result;
    }
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      action: "devices.boot",
      cwd: s.project.cwd,
      input: { machineId: "mac", deviceId: "ios" },
    });
    expect(
      (
        await s.call(
          "conversation.desktop.finish",
          { id: requests[0].id, result: {} },
          s.second.token,
        )
      ).value.error,
    ).toContain("another device");
    await s.call("conversation.desktop.finish", { id: requests[0].id, error: "Mac disconnected" });
    expect((await pending).value.error).toBe("Mac disconnected");
    expect((await s.call("conversation.desktop.take")).value.result).toEqual([]);
  });
  it("reads captured terminal output through bounded project logs and scrubs secrets", async () => {
    const s = await sessionTools();
    const other = s.store.addProject(join(s.project.cwd, "other"), "Other");
    for (const [cwd, id, output] of [
      [s.project.cwd, "own-terminal", "ready\nAuthorization: Bearer secret-value\n"],
      [other.cwd, "other-terminal", "foreign-output\n"],
    ]) {
      await s.call("runtimeLogs.terminals.append", {
        cwd,
        terminalId: id,
        sequence: 0,
        data: Buffer.from(output).toString("base64"),
      });
    }
    const result = (await s.tool("terminals.read", { terminalId: "own-terminal", limit: 10 })).value
      .result;
    expect(JSON.stringify(result)).toContain("ready");
    expect(JSON.stringify(result)).not.toContain("secret-value");
    expect(
      JSON.stringify(
        (await s.tool("terminals.read", { terminalId: "other-terminal" })).value.result,
      ),
    ).not.toContain("foreign-output");
    expect(
      (await s.tool("terminals.write", { terminalId: "own-terminal", data: "pwd\n" })).value.error,
    ).toContain("offline");
  });
});

describe("conversation browser runtime", () => {
  it("advertises explicit setup, reports missing runtime and validates its project before downloading", async () => {
    const s = await setup();
    expect((await s.call("environment.describe")).value.result.capabilities).toContain(
      "browser.shared.setup",
    );
    expect((await s.call("browser.status")).value.result.runtime).toMatchObject({
      installed: false,
      installing: false,
      version: "1.64.0",
    });
    expect((await s.call("browser.setup", { projectId: "missing" })).value.error).toBeTruthy();
    expect((await s.call("browser.status")).value.result.runtime.installing).toBe(false);
  });

  it("supports paired machine tools without borrowing another machine's project", async () => {
    const s = await setup();
    const install = vi.spyOn(BrowserRuntime.prototype, "setup").mockResolvedValue({
      installed: true,
      installing: false,
      version: "1.64.0",
      lastError: undefined,
    });
    try {
      expect((await s.call("environment.describe")).value.result.capabilities).toContain(
        "host.tools.machine-targets",
      );
      expect((await s.call("devices.status")).value.result).toHaveProperty("platform");
      expect(
        (await s.call("devices.status", { projectId: "foreign-project" })).value.error,
      ).toBeTruthy();
      expect((await s.call("devices.status", {}, "invalid")).status).toBe(401);
      expect((await s.call("browser.setup")).value.result).toHaveProperty("runtime");
      expect(install).toHaveBeenCalledOnce();
      expect(
        (await s.call("browser.setup", { projectId: "foreign-project" })).value.error,
      ).toBeTruthy();
      expect((await s.call("browser.setup", {}, "invalid")).status).toBe(401);
      expect(install).toHaveBeenCalledOnce();
      // Conversation-owned data still require a real project/session on this host.
      expect(
        (await s.call("browser.annotation.start", { sessionId: "foreign-session" })).value.error,
      ).toBeTruthy();
    } finally {
      install.mockRestore();
    }
  });
});

async function setup(providers: RemoteProvider[] = ["codex"]) {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-server-test-"));
  const store = new HostStore(join(directory, "host.db"));
  let turn: SendTurnInput | undefined;
  let finish = () => {};
  const send = vi.fn((input: SendTurnInput) => {
    turn = input;
    return new Promise<void>((resolve) => {
      finish = resolve;
    });
  });
  const engine = new HostEngine(store, {
    codex: {
      send,
      stop: async () => finish(),
      cancel: async () => finish(),
      bind: () => {},
      approve: () => {},
      answer: () => {},
    },
  });
  // Follow production's canonicalization, including Windows 8.3 paths such
  // as RUNNER~1 in the CI runner's temporary directory.
  const project = await engine.openProject(directory);
  const server = createHostServer(engine, providers);
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
  } catch (error) {
    store.close();
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/rpc`;
  const first = store.issueDevice("Laptop");
  const second = store.issueDevice("Other computer");
  const call = async (
    method: string,
    params: unknown = {},
    token = first.token,
    overrides: Record<string, unknown> = {},
    headers: Record<string, string> = {},
  ) => {
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, ...headers },
      body: JSON.stringify({
        version: 1,
        environmentId: store.environmentId,
        method,
        params,
        ...overrides,
      }),
    });
    return {
      status: response.status,
      value: (await response.json()) as { result?: any; error?: string },
    };
  };
  cleanups.push(async () => {
    await engine.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return {
    url,
    server,
    directory,
    engine,
    store,
    project,
    call,
    first,
    second,
    send,
    turn: () => turn!,
    finish: () => finish(),
  };
}

describe("shared queued messages", () => {
  it("shares unsent rows between paired computers and consumes them with a durable receipt once", async () => {
    const s = await setup();
    const created = s.engine.command({
      type: "create",
      commandId: "queue-create",
      projectId: s.project.id,
      harness: "codex",
      model: "gpt",
      runtimeMode: "supervised",
    });
    const sessionId = created.sessionId;
    const clientId = "remote:pc1";
    const messages = [{ id: "queued", text: "do this after the current task", attachments: [] }];
    expect((await s.call("environment.describe")).value.result.capabilities).toContain(
      "sessions.queue",
    );
    const published = await s.call("sessions.queue.change", {
      sessionId,
      clientId,
      before: { messages: [] },
      after: { messages, status: "active" },
      takeOwnership: true,
    });
    expect(published.value.error).toBeUndefined();
    const read = await s.call(
      "sessions.queue.get",
      { sessionId, clientId: "remote:pc2" },
      s.second.token,
    );
    expect(read.value.result.messages).toEqual(messages);
    const changed = await s.call(
      "sessions.queue.change",
      {
        sessionId,
        clientId: "remote:pc2",
        before: read.value.result,
        after: { ...read.value.result, messages: [{ ...messages[0], text: "edited on pc2" }] },
      },
      s.second.token,
    );
    const command = {
      type: "send",
      commandId: "queue-send",
      sessionId,
      text: "edited on pc2",
      queued: { id: "queued", clientId, revision: changed.value.result.revision },
    };
    const stale = await s.call("commands.dispatch", {
      ...command,
      queued: { ...command.queued, revision: published.value.result.revision },
    });
    expect(stale.value.error).toMatch(/queue changed/i);
    const accepted = await s.call("commands.dispatch", command);
    expect(accepted.value.error).toBeUndefined();
    const repeat = await s.call("commands.dispatch", command, s.second.token);
    expect(repeat.value.result).toEqual(accepted.value.result);
    expect(
      (await s.call("sessions.queue.get", { sessionId, clientId })).value.result.messages,
    ).toEqual([]);
    await vi.waitFor(() => expect(s.send).toHaveBeenCalledOnce());
    expect(
      (await s.call("sessions.queue.get", { sessionId: "foreign-session", clientId })).value.error,
    ).toBeTruthy();
    expect((await s.call("sessions.queue.get", { sessionId, clientId }, "invalid")).status).toBe(
      401,
    );
  });
});

describe("project directory endpoint", () => {
  it("advertises the version and returns only the desktop's visible group projection", async () => {
    const s = await setup();
    expect((await s.call("environment.describe")).value.result.capabilities).toContain(
      "projects.directory.v1",
    );
    expect((await s.call("projects.directory", {}, "invalid")).status).toBe(401);
    expect((await s.call("projects.directory")).value.result).toMatchObject({
      privacyReady: false,
      groups: [],
      projects: [],
    });
    const one = s.store.addProject("G:/Work/shared", "One");
    const two = s.store.addProject("g:\\work\\shared", "Two");
    s.store.addProject("G:/Private", "Private client");
    expect(
      (
        await s.call("sessions.desktopLive", {
          clientId: "desktop",
          sessions: [],
          projectDirectory: {
            version: 1,
            groups: [{ id: "work", name: "Work" }],
            projects: [{ cwd: "g:/work/shared", name: "Shared", groupId: "work" }],
            excludedPaths: ["g:/private"],
            excludedGroupIds: ["private"],
          },
        })
      ).status,
    ).toBe(200);
    const result = (await s.call("projects.directory")).value.result;
    expect(result.groups).toEqual([{ id: "work", name: "Work" }]);
    expect(
      result.projects.filter((project: { id: string }) => [one.id, two.id].includes(project.id)),
    ).toHaveLength(2);
    expect(JSON.stringify(result)).not.toContain("Private client");
  });
});

describe("runtime log access", () => {
  it("captures authenticated native terminal output in its owning project", async () => {
    const s = await setup();
    const packet = {
      cwd: s.project.cwd,
      terminalId: "test-terminal",
      sequence: 0,
      data: Buffer.from("✓ Ready in 10ms\nGET / 200 in 2ms\n").toString("base64"),
    };
    expect((await s.call("runtimeLogs.terminals.append", packet, "invalid")).status).toBe(401);
    expect((await s.call("runtimeLogs.terminals.append", packet)).status).toBe(200);
    const snapshot = (
      await s.call("runtimeLogs.read", { projectId: s.project.id, source: "server" })
    ).value.result;
    expect(snapshot.entries.map((entry: { message: string }) => entry.message)).toEqual([
      "✓ Ready in 10ms",
      "GET / 200 in 2ms",
    ]);
    expect(snapshot.sources).toContainEqual(
      expect.objectContaining({ kind: "server", available: true, projectId: s.project.id }),
    );
  });
  it("advertises log capture and rejects foreign project/session scopes", async () => {
    const s = await setup();
    expect((await s.call("environment.describe")).value.result.capabilities).toContain(
      "runtime.logs",
    );
    expect((await s.call("runtimeLogs.read", { projectId: "foreign" })).status).toBe(400);
    expect((await s.call("runtimeLogs.read", { sessionId: "missing" })).status).toBe(400);
    expect((await s.call("runtimeLogs.read", {}, "invalid")).status).toBe(401);
    expect(
      (await s.call("runtimeLogs.read", { projectId: s.project.id })).value.result,
    ).toMatchObject({
      entries: [],
      cursor: 0,
      dropped: 0,
    });
  });

  it("derives agent project identity and keeps log grants independent from social access", async () => {
    const s = await setup();
    const session = s.engine.command({
      type: "create",
      commandId: "log-session",
      projectId: s.project.id,
      harness: "codex",
      model: "codex:test",
      runtimeMode: "supervised",
    });
    const social = s.server.social.issueSessionGrant(session.sessionId);
    const issued = await s.call("runtimeLogs.access.issue", { sessionId: session.sessionId });
    expect(issued.status).toBe(200);
    const grant = issued.value.result;
    expect(s.server.social.principalForToken(social.token)).toBeTruthy();
    const read = vi.spyOn(RuntimeLogsService.prototype, "read");
    try {
      expect(
        (
          await s.call(
            "runtimeLogs.tools.call",
            {
              action: "read",
              input: { search: "failure", limit: 20 },
            },
            grant.token,
          )
        ).status,
      ).toBe(200);
      expect(read).toHaveBeenLastCalledWith(
        expect.objectContaining({ projectId: s.project.id, search: "failure", limit: 20 }),
      );
      expect(
        (
          await s.call(
            "runtimeLogs.tools.call",
            {
              action: "read",
              input: { projectId: "foreign" },
            },
            grant.token,
          )
        ).status,
      ).toBe(400);
      for (const method of [
        "runtimeLogs.read",
        "runtimeLogs.terminals.append",
        "runtimeLogs.monitors.list",
        "runtimeLogs.monitors.start",
        "runtimeLogs.monitors.stop",
        "runtimeLogs.access.issue",
        "social.tools.call",
        "projects.list",
      ])
        expect((await s.call(method, {}, grant.token)).status).toBe(400);
      expect(
        (await s.call("runtimeLogs.tools.call", { action: "read", input: {} }, social.token))
          .status,
      ).toBe(400);
      expect((await s.call("runtimeLogs.tools.call", { action: "read", input: {} })).status).toBe(
        400,
      );
      s.store.revokeDevice(s.first.id);
      expect(
        (await s.call("runtimeLogs.tools.call", { action: "read", input: {} }, grant.token)).status,
      ).toBe(401);
    } finally {
      read.mockRestore();
    }
  });
});

describe("remote host API", () => {
  it("keeps mobile pairing and access RPCs limited to authenticated paired devices", async () => {
    const s = await setup();
    const session = s.engine.command({
      type: "create",
      commandId: "mobile-session-auth",
      projectId: s.project.id,
      harness: "codex",
      model: "codex:test",
      runtimeMode: "supervised",
    });
    const grant = s.server.social.issueSessionGrant(session.sessionId);
    const methods = [
      "mobile.pairing.create",
      "mobile.pairing.status",
      "mobile.pairing.cancel",
      "mobile.access.status",
      "mobile.access.enable",
      "mobile.access.disable",
    ];
    const params = { name: "Test phone", pairingId: "11111111-1111-4111-8111-111111111111" };
    for (const method of methods) {
      expect((await s.call(method, params, "invalid")).status).toBe(401);
      const social = await s.call(method, params, grant.token);
      expect(social.status).toBe(400);
      expect(social.value.error).toContain("Session social credentials cannot access");
      expect(
        (await s.call(method, params, s.first.token, {}, { Origin: "https://untrusted.example" }))
          .status,
      ).toBe(403);
    }
    s.store.revokeDevice(s.first.id);
    for (const method of methods) expect((await s.call(method, params)).status).toBe(401);
    expect(
      (await s.call("mobile.pairing.create", { name: "Other desktop phone" }, s.second.token))
        .status,
    ).toBe(200);
  });

  it("redeems a mobile QR through the narrow public route once and rechecks issuer revocation", async () => {
    const s = await setup();
    const before = Number(s.store.db.prepare("SELECT count(*) AS count FROM devices").get()!.count);
    const created = await s.call("mobile.pairing.create", { name: "My phone" });
    expect(created.status).toBe(200);
    const ticket = created.value.result;
    expect(
      (await s.call("mobile.pairing.status", { pairingId: ticket.pairingId }, s.second.token)).value
        .result,
    ).toEqual({ state: "expired" });
    expect(
      (await s.call("mobile.pairing.cancel", { pairingId: ticket.pairingId }, s.second.token)).value
        .result,
    ).toEqual({ state: "expired" });
    const input = {
      version: 1,
      environmentId: s.store.environmentId,
      ticket: ticket.ticket,
      claimId: randomBytes(32).toString("base64url"),
      deviceName: "Test Android phone",
    };
    const redeem = async (params = input) => {
      const response = await fetch(new URL("/mobile/pairing/redeem", s.url), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });
      return { status: response.status, value: await response.json() };
    };
    const first = await redeem();
    expect(first.status).toBe(200);
    expect(await redeem()).toEqual(first);
    const paired = first.value.result;
    expect(Number(s.store.db.prepare("SELECT count(*) AS count FROM devices").get()!.count)).toBe(
      before + 1,
    );
    expect(s.store.authenticated(paired.token)).toBe(true);
    expect(
      (await s.call("environment.describe", {}, paired.token)).value.result.environmentId,
    ).toBe(s.store.environmentId);
    expect(
      (await s.call("mobile.pairing.status", { pairingId: ticket.pairingId })).value.result,
    ).toEqual({ state: "paired", deviceName: "Test Android phone" });
    expect(
      (await redeem({ ...input, claimId: randomBytes(32).toString("base64url") })).status,
    ).toBe(400);
    s.store.revokeDevice(s.first.id);
    expect((await redeem()).status).toBe(400);
    expect(Number(s.store.db.prepare("SELECT count(*) AS count FROM devices").get()!.count)).toBe(
      before,
    );
    // Revoking the issuer does not revoke a phone that was already paired.
    expect((await s.call("environment.describe", {}, paired.token)).status).toBe(200);
  });

  it("returns bounded machine change cursors and command receipt status", async () => {
    const s = await setup();
    const created = s.engine.command({
      type: "create",
      commandId: "status-create",
      projectId: s.project.id,
      harness: "codex",
      model: "codex:test",
      runtimeMode: "supervised",
    });
    const reset = await s.call("machine.changes", {
      sessions: [{ sessionId: created.sessionId, revision: 0 }],
      projects: [{ projectId: s.project.id }],
      tasksKnown: "",
    });
    expect(reset.value.result).toMatchObject({
      reset: true,
      instanceId: expect.any(String),
      sessions: [{ sessionId: created.sessionId, revision: created.revision }],
      projects: [
        {
          projectId: s.project.id,
          etag: expect.any(String),
          sessions: expect.any(Array),
        },
      ],
    });
    expect(reset.value.result.tasks).toEqual({ etag: expect.any(String) });
    const steady = await s.call("machine.changes", {
      instanceId: reset.value.result.instanceId,
      sessions: [{ sessionId: created.sessionId, revision: created.revision }],
      projects: [{ projectId: s.project.id, known: reset.value.result.projects[0].etag }],
      tasksKnown: reset.value.result.tasks.etag,
    });
    expect(steady.value.result).toMatchObject({
      reset: false,
      sessions: [],
      projects: [],
    });
    const summaries = vi.spyOn(s.store, "summaries");
    await s.call("machine.changes", {
      instanceId: reset.value.result.instanceId,
      waitMs: 400,
      sessions: [{ sessionId: created.sessionId, revision: created.revision }],
      projects: [{ projectId: s.project.id, known: reset.value.result.projects[0].etag }],
    });
    expect(summaries.mock.calls.length).toBeLessThanOrEqual(1);
    expect(
      (await s.call("commands.status", { commandId: "status-create" })).value.result,
    ).toMatchObject({
      commandId: "status-create",
      sessionId: created.sessionId,
    });
    expect((await s.call("commands.status", { commandId: "missing" })).value.result).toBeNull();
    expect(
      (await s.call("machine.changes", { sessions: [], projects: [] }, "invalid")).status,
    ).toBe(401);
  });

  it("keeps partial sync bounded to the loaded transcript tail", async () => {
    const s = await setup();
    const created = s.engine.command({
      type: "create",
      commandId: "partial-create",
      projectId: s.project.id,
      harness: "codex",
      model: "codex:test",
      runtimeMode: "supervised",
    });
    const base = s.store.session(created.sessionId);
    const original = {
      id: "loaded",
      role: "assistant" as const,
      text: "first",
    };
    const loaded = s.store.save(
      {
        ...base,
        revision: base.revision + 1,
        updatedAt: base.updatedAt + 1,
        session: { ...base.session, blocks: [original] },
      },
      { type: "test" },
    );
    const appended = {
      id: "appended",
      role: "assistant" as const,
      text: "second",
    };
    const current = s.store.save(
      {
        ...loaded,
        revision: loaded.revision + 1,
        updatedAt: loaded.updatedAt + 1,
        session: {
          ...loaded.session,
          blocks: [...loaded.session.blocks, appended],
        },
      },
      { type: "test" },
    );
    const loadedBlockIds = loaded.session.blocks.map((block) => block.id);
    const delta = await s.call("sessions.sync", {
      sessionId: created.sessionId,
      revision: base.revision,
      partial: true,
      loadedBlockIds,
    });
    expect(delta.status).toBe(200);
    expect(delta.value.result).toMatchObject({
      kind: "delta",
      partial: true,
      value: {
        history: {
          revision: current.revision,
          totalBlocks: current.session.blocks.length,
        },
      },
    });
    expect(delta.value.result.blockIds).toEqual(
      current.session.blocks.map((block: { id: string }) => block.id),
    );
    expect(
      (
        await s.call("sessions.sync", {
          sessionId: created.sessionId,
          partial: true,
          loadedBlockIds: ["not-present"],
        })
      ).value.result,
    ).toMatchObject({
      kind: "snapshot",
      value: { history: { revision: current.revision } },
    });
  });

  it("previews an oversized tail block and serves its full revision-pinned content on demand", async () => {
    const s = await setup();
    const created = s.engine.command({
      type: "create",
      commandId: "large-block-create",
      projectId: s.project.id,
      harness: "codex",
      model: "codex:test",
      runtimeMode: "supervised",
    });
    const before = s.store.session(created.sessionId);
    const large = {
      id: "large-tail",
      role: "assistant" as const,
      text: "x".repeat(2_000_000),
    };
    const current = s.store.save(
      {
        ...before,
        revision: before.revision + 1,
        updatedAt: before.updatedAt + 1,
        session: { ...before.session, blocks: [large] },
      },
      { type: "test" },
    );
    const page = await s.call("sessions.page", {
      sessionId: created.sessionId,
      preview: true,
    });
    const preview = page.value.result.sync.value.session.blocks[0];
    expect(preview).toMatchObject({
      id: "large-tail",
      remoteContent: { revision: current.revision, bytes: expect.any(Number) },
    });
    expect(preview.text.length).toBeLessThan(64 * 1024);
    const legacy = await s.call("sessions.page", {
      sessionId: created.sessionId,
    });
    expect(legacy.value.result.sync.value.session.blocks[0]).toMatchObject({
      id: "large-tail",
      text: large.text,
    });
    expect(legacy.value.result.sync.value.session.blocks[0]).not.toHaveProperty("remoteContent");
    const full = await s.call("sessions.block", {
      sessionId: created.sessionId,
      blockId: "large-tail",
      revision: current.revision,
    });
    expect(full.value.result).toMatchObject({
      kind: "snapshot",
      value: {
        revision: current.revision,
        session: {
          blocks: [{ id: "large-tail", text: "x".repeat(2_000_000) }],
        },
      },
    });
    expect(
      (
        await s.call("sessions.block", {
          sessionId: created.sessionId,
          blockId: "large-tail",
          revision: current.revision - 1,
        })
      ).status,
    ).not.toBe(200);
  });

  it("accepts a command while a revision long-poll is pending", async () => {
    const s = await setup();
    const created = s.engine.command({
      type: "create",
      commandId: "longpoll-create",
      projectId: s.project.id,
      harness: "codex",
      model: "codex:test",
      runtimeMode: "supervised",
    });
    const waiting = s.call("sessions.sync", {
      sessionId: created.sessionId,
      revision: created.revision,
      waitMs: 10_000,
    });
    const sent = await s.call("commands.dispatch", {
      type: "send",
      commandId: "longpoll-send",
      sessionId: created.sessionId,
      text: "go",
    });
    expect(sent.status).toBe(200);
    const update = await waiting;
    expect(update.value.result.kind).toBe("delta");
    expect(
      update.value.result.blocks.filter((block: { role: string }) => block.role === "user"),
    ).toHaveLength(1);
  });
  it("returns metadata for chat folder paths, including the workspace root", async () => {
    const s = await setup();
    const root = s.project.cwd.replace(/\\/g, "/");
    mkdirSync(join(s.directory, "assets"));
    writeFileSync(join(s.directory, "guide.md"), "guide");
    const response = await s.call("workspace.run", {
      command: "stat_files",
      args: {
        paths: [root, `${root}/assets`, `${root}/guide.md`, `${root}/missing`],
      },
    });
    expect(response.value.result).toEqual([
      { path: root, mtimeMs: null, isDir: true },
      { path: `${root}/assets`, mtimeMs: null, isDir: true },
      { path: `${root}/guide.md`, mtimeMs: expect.any(Number), isDir: false },
      { path: `${root}/missing`, mtimeMs: null, isDir: false },
    ]);
  });

  it("rejects a credential revoked while its request body is arriving", async () => {
    const s = await setup();
    const authenticated = vi.spyOn(s.store, "authenticated");
    const body = JSON.stringify({
      version: 1,
      environmentId: s.store.environmentId,
      method: "commands.dispatch",
      params: {
        type: "create",
        commandId: "revoked-create",
        projectId: s.project.id,
        harness: "codex",
        model: "codex:test",
        runtimeMode: "supervised",
      },
    });
    let req: ReturnType<typeof request>;
    const response = new Promise<number | undefined>((resolve, reject) => {
      req = request(
        s.url,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${s.first.token}`,
            "Content-Length": Buffer.byteLength(body),
          },
        },
        (res) => {
          res.resume();
          res.on("end", () => resolve(res.statusCode));
        },
      );
      req.on("error", reject);
      req.write(body.slice(0, 1));
    });
    await vi.waitFor(() => expect(authenticated).toHaveBeenCalledTimes(1));
    s.store.revokeToken(s.first.token);
    req!.end(body.slice(1));
    expect(await response).toBe(401);
    expect(s.store.summaries(s.project.id)).toEqual([]);
  });

  it("uploads an authenticated attachment and sends its host path to the provider", async () => {
    const s = await setup();
    const id = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const upload = {
      id,
      offset: 0,
      size: 5,
      data: Buffer.from("hello").toString("base64"),
    };
    expect((await s.call("attachments.upload", upload, "invalid")).status).toBe(401);
    expect((await s.call("attachments.upload", upload)).value.result).toEqual({
      offset: 5,
    });
    const created = await s.call("commands.dispatch", {
      type: "create",
      commandId: "upload-create",
      projectId: s.project.id,
      harness: "codex",
      model: "codex:test",
      runtimeMode: "supervised",
    });
    const sessionId = created.value.result.sessionId;
    const sent = await s.call("commands.dispatch", {
      type: "send",
      commandId: "upload-send",
      sessionId,
      text: "Read this",
      attachments: [
        {
          id,
          name: "notes.txt",
          mimeType: "text/plain",
          kind: "file",
          size: 5,
        },
      ],
    });
    expect(sent.status).toBe(200);
    await vi.waitFor(() => expect(s.send).toHaveBeenCalledTimes(1));
    expect(s.turn().attachments?.[0].path).toContain(id);
    s.finish();
  });
  it("applies card actions to the owning project and lists their saved state", async () => {
    const s = await setup();
    const create = await s.call("commands.dispatch", {
      type: "create",
      commandId: "card-session",
      projectId: s.project.id,
      harness: "codex",
      model: "codex:test",
      runtimeMode: "supervised",
    });
    const sessionId = create.value.result.sessionId;
    const changed = await s.call("sessions.update", {
      projectId: s.project.id,
      sessionId,
      title: "Codex · Card title",
      pinned: true,
    });
    expect(changed.status).toBe(200);
    expect(
      (await s.call("sessions.list", { projectId: s.project.id })).value.result[0],
    ).toMatchObject({
      id: sessionId,
      title: "Codex · Card title",
      pinned: true,
      model: "codex:test",
    });
    expect(
      (
        await s.call("sessions.update", {
          projectId: "wrong-project",
          sessionId,
          archived: true,
        })
      ).status,
    ).not.toBe(200);
    expect(
      (
        await s.call("sessions.delete", {
          projectId: "wrong-project",
          sessionId,
        })
      ).status,
    ).not.toBe(200);
    expect(
      (
        await s.call("sessions.delete", {
          projectId: s.project.id,
          sessionId,
        })
      ).status,
    ).toBe(200);
    expect((await s.call("sessions.list", { projectId: s.project.id })).value.result).toEqual([]);
  });

  it("lists, creates, and selects registered remote worktrees through RPC", async () => {
    const s = await setup();
    const git = (...args: string[]) => execFileSync("git", args, { cwd: s.project.cwd });
    git("init", "-q");
    git("config", "core.autocrlf", "false");
    git("checkout", "-q", "-b", "main");
    writeFileSync(join(s.project.cwd, ".gitignore"), "host.db*\n");
    writeFileSync(join(s.project.cwd, "file.txt"), "initial\n");
    git("add", ".gitignore", "file.txt");
    git(
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "-q",
      "-m",
      "initial",
    );

    const branch = await s.call("git.createBranch", {
      projectId: s.project.id,
      branch: "feature",
    });
    expect(branch.value.result.current).toBe("feature");
    expect(
      (await s.call("git.switch", { projectId: s.project.id, branch: "main" })).value.result
        .current,
    ).toBe("main");
    // Prime the allowed-root cache before creating a checkout.
    expect(
      (
        await s.call("workspace.run", {
          command: "list_dir",
          args: { path: s.project.cwd },
        })
      ).status,
    ).toBe(200);
    const created = await s.call("git.worktreeCreate", {
      projectId: s.project.id,
      branch: "feature",
      base: "HEAD",
      existing: true,
    });
    expect(created.status).toBe(200);
    const tree = created.value.result;
    cleanups.push(async () =>
      rmSync(join(s.project.cwd, "..", `${s.project.name}-worktrees`), {
        recursive: true,
        force: true,
      }),
    );
    expect(tree.branch).toBe("feature");
    expect(
      (
        await s.call("workspace.run", {
          command: "read_text_file",
          args: {
            path: join(tree.path, "file.txt"),
          },
        })
      ).value.result,
    ).toBe("initial\n");
    expect(
      (await s.call("git.worktrees", { projectId: s.project.id })).value.result.worktrees,
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: tree.path, branch: "feature" })]),
    );

    const opened = await s.call("commands.dispatch", {
      type: "create",
      commandId: "in-worktree",
      projectId: s.project.id,
      worktreeCwd: tree.path,
      harness: "codex",
      model: "codex:test",
      runtimeMode: "supervised",
    });
    expect(opened.status).toBe(200);
    expect(s.store.session(opened.value.result.sessionId).session.cwd).toBe(tree.path);
    expect(
      (await s.call("sessions.list", { projectId: s.project.id })).value.result[0],
    ).toMatchObject({
      id: opened.value.result.sessionId,
      branch: "feature",
      worktreeCwd: tree.path,
      repo: s.project.name,
    });
    expect(
      (
        await s.call("commands.dispatch", {
          type: "create",
          commandId: "outside-worktree",
          projectId: s.project.id,
          worktreeCwd: tmpdir(),
          harness: "codex",
          model: "codex:test",
          runtimeMode: "supervised",
        })
      ).value.error,
    ).toContain("available worktree");

    writeFileSync(join(tree.path, "file.txt"), "changed\n");
    expect(
      (await s.call("git.diff", { projectId: s.project.id, cwd: tree.path })).value.result,
    ).toContain("changed");
  });
  it("retries model discovery after a provider becomes available", async () => {
    const s = await setup();
    modelProbe.mockRejectedValueOnce(new Error("Login required"));
    modelProbe.mockResolvedValueOnce([{ id: "codex:test", name: "Test" }]);
    const first = await s.call("models.list", { projectId: s.project.id });
    expect(first.value.result.errors.codex).toBe("Login required");
    const second = await s.call("models.list", { projectId: s.project.id });
    expect(second.value.result.models.codex).toEqual([{ id: "codex:test", name: "Test" }]);
    expect(modelProbe).toHaveBeenCalledTimes(2);
  });
  it("advertises newer providers only to desktops that request them", async () => {
    const s = await setup(["codex", "cursor"]);
    expect((await s.call("environment.describe")).value.result.providers).toEqual(["codex"]);
    expect(
      (
        await s.call("environment.describe", {
          supportedProviders: ["codex", "cursor"],
        })
      ).value.result.providers,
    ).toEqual(["codex", "cursor"]);
  });
  it("re-probes models after the provider CLI is updated", async () => {
    const s = await setup();
    cleanups.push(async () => {
      delete binaries.codex;
    });
    writeFileSync(join(s.directory, "codex-1"), "");
    writeFileSync(join(s.directory, "codex-2"), "");
    binaries.codex = join(s.directory, "codex-1");
    modelProbe.mockClear();
    modelProbe.mockResolvedValueOnce([{ id: "codex:old", name: "Old" }]);
    modelProbe.mockResolvedValueOnce([{ id: "codex:new", name: "New" }]);
    const list = async () =>
      (await s.call("models.list", { projectId: s.project.id })).value.result.models.codex;
    expect(await list()).toEqual([{ id: "codex:old", name: "Old" }]);
    expect(await list()).toEqual([{ id: "codex:old", name: "Old" }]);
    binaries.codex = join(s.directory, "codex-2");
    expect(await list()).toEqual([{ id: "codex:new", name: "New" }]);
    expect(modelProbe).toHaveBeenCalledTimes(2);
  });
  it("re-probes models once the catalog is five minutes old", async () => {
    const s = await setup();
    modelProbe.mockClear();
    modelProbe.mockResolvedValueOnce([{ id: "codex:old", name: "Old" }]);
    modelProbe.mockResolvedValueOnce([{ id: "codex:new", name: "New" }]);
    const list = async () =>
      (await s.call("models.list", { projectId: s.project.id })).value.result.models.codex;
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      expect(await list()).toEqual([{ id: "codex:old", name: "Old" }]);
      vi.setSystemTime(Date.now() + 4 * 60_000);
      expect(await list()).toEqual([{ id: "codex:old", name: "Old" }]);
      vi.setSystemTime(Date.now() + 60_000);
      expect(await list()).toEqual([{ id: "codex:new", name: "New" }]);
    } finally {
      vi.useRealTimers();
    }
    expect(modelProbe).toHaveBeenCalledTimes(2);
  });
  it("lets an authenticated desktop browse host folders without reading files", async () => {
    const s = await setup();
    mkdirSync(join(s.directory, "checkout"));
    writeFileSync(join(s.directory, "private.txt"), "secret");
    const listed = await s.call("projects.browse", { path: s.directory });
    expect(listed.status).toBe(200);
    expect(listed.value.result.entries).toEqual([
      { name: "checkout", path: join(s.directory, "checkout") },
    ]);
    expect((await s.call("projects.browse", { path: s.directory }, "invalid")).status).toBe(401);
  });
  it("allows a different client to recover work completed while the laptop was disconnected", async () => {
    const s = await setup();
    const create = await s.call("commands.dispatch", {
      type: "create",
      commandId: "create",
      projectId: s.project.id,
      harness: "codex",
      model: "codex:test",
      runtimeMode: "supervised",
    });
    const id = create.value.result.sessionId;
    const command = {
      type: "send",
      commandId: "send",
      sessionId: id,
      text: "Work without this client",
    };
    await s.call("commands.dispatch", command);
    await vi.waitFor(() => expect(s.send).toHaveBeenCalledTimes(1));
    s.turn().onEvent({ type: "message.delta", text: "Finished on the host" });
    s.finish();
    await vi.waitFor(() => expect(s.store.session(id).status).toBe("idle"));
    const recovered = await s.call("sessions.get", { sessionId: id }, s.second.token);
    expect(recovered.value.result.session.blocks.at(-1).text).toBe("Finished on the host");
    await s.call("commands.dispatch", command, s.second.token);
    expect(s.send).toHaveBeenCalledTimes(1);
  });

  it("rejects revoked devices, browser origins, and changed host identities", async () => {
    const s = await setup();
    expect((await s.call("environment.describe", {}, "invalid")).status).toBe(401);
    expect(
      (
        await s.call(
          "environment.describe",
          {},
          s.first.token,
          {},
          { Origin: "https://untrusted.example" },
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await s.call("projects.list", {}, s.first.token, {
          environmentId: "different-host",
        })
      ).value.error,
    ).toContain("identity changed");
    // Revoked from a separate connection, as the CLI does.
    const other = new DatabaseSync(s.store.db.location()!);
    other.prepare("DELETE FROM devices WHERE id=?").run(s.first.id);
    other.close();
    expect((await s.call("environment.describe")).status).toBe(401);
    expect((await s.call("environment.describe", {}, s.second.token)).status).toBe(200);
  });

  it("lets a desktop revoke only its own credential, keeping sessions", async () => {
    const s = await setup();
    const create = await s.call("commands.dispatch", {
      type: "create",
      commandId: "create",
      projectId: s.project.id,
      harness: "codex",
      model: "codex:test",
      runtimeMode: "supervised",
    });
    const id = create.value.result.sessionId;
    expect((await s.call("devices.revokeSelf")).value.result).toEqual({
      revoked: true,
    });
    expect((await s.call("environment.describe")).status).toBe(401);
    const other = await s.call("sessions.sync", { sessionId: id }, s.second.token);
    expect(other.value.result.value.session.id).toBe(id);
  });

  it("reads host files while rejecting traversal and symlink escapes", async () => {
    const s = await setup();
    writeFileSync(join(s.directory, "hello.txt"), "from host");
    expect(
      await s.call("files.read", {
        projectId: s.project.id,
        cwd: s.project.cwd,
        path: "hello.txt",
      }),
    ).toEqual({ status: 200, value: { result: "from host" } });
    expect(
      await s.call("files.write", {
        projectId: s.project.id,
        path: "hello.txt",
        expected: "from host",
        content: "edited",
      }),
    ).toEqual({ status: 200, value: { result: null } });
    expect(
      (
        await s.call("files.read", {
          projectId: s.project.id,
          path: "hello.txt",
        })
      ).value.result,
    ).toBe("edited");
    symlinkSync(
      tmpdir(),
      join(s.directory, "outside"),
      process.platform === "win32" ? "junction" : "dir",
    );
    expect(
      (await s.call("files.read", { projectId: s.project.id, path: "outside" })).value.error,
    ).toContain("outside");
    const sibling = `${s.directory}-outside.txt`;
    writeFileSync(sibling, "must not be exposed");
    try {
      expect(
        (await s.call("files.read", { projectId: s.project.id, path: sibling })).value.error,
      ).toContain("outside");
    } finally {
      rmSync(sibling);
    }
    expect(
      (await s.call("files.read", { projectId: s.project.id, path: ".." })).value.error,
    ).toContain("outside");
  });

  it("browses folders outside projects without granting content or mutation access", async () => {
    const s = await setup();
    const outside = mkdtempSync(join(tmpdir(), "bycoda-artifacts-"));
    cleanups.push(async () => rmSync(outside, { recursive: true, force: true }));
    mkdirSync(join(outside, "archive"));
    const file = join(outside, "installer.exe");
    writeFileSync(file, "private binary contents");
    const run = async (command: string, args: Record<string, unknown>) =>
      (await s.call("workspace.run", { command, args })).value;
    const folder = (await run("browse_dir", { path: file, containing: true })).result;
    expect(folder).toMatchObject({ path: outside, canOpenFiles: false });
    expect(folder.entries.map((entry: { name: string }) => entry.name)).toEqual([
      "archive",
      "installer.exe",
    ]);
    expect(JSON.stringify(folder)).not.toContain("private binary contents");
    expect((await run("browse_dir", { path: join(outside, "archive") })).result.parent).toBe(
      outside,
    );
    for (const command of [
      "list_dir",
      "read_text_file",
      "read_binary_file",
      "read_file_preview",
      "delete_path",
    ])
      expect((await run(command, { path: file })).error).toContain("outside");
    expect((await run("write_text_file", { path: file, content: "changed" })).error).toContain(
      "outside",
    );
    expect(
      (await run("create_path", { parent: outside, name: "new.txt", isDir: false })).error,
    ).toContain("outside");
    expect(
      (
        await s.call(
          "workspace.run",
          { command: "browse_dir", args: { path: outside } },
          "invalid-token",
        )
      ).status,
    ).toBe(401);
    expect((await run("browse_dir", { path: s.project.cwd })).result.canOpenFiles).toBe(true);
    const linked = join(s.project.cwd, "artifacts");
    symlinkSync(outside, linked, process.platform === "win32" ? "junction" : "dir");
    expect((await run("browse_dir", { path: linked })).result.canOpenFiles).toBe(false);
    expect(
      (await run("read_binary_file", { path: join(linked, "installer.exe") })).error,
    ).toContain("outside");
  });

  it("answers this app's file commands inside host projects only", async () => {
    const s = await setup();
    const outside = mkdtempSync(join(tmpdir(), "bycoda-outside-"));
    cleanups.push(async () => rmSync(outside, { recursive: true, force: true }));
    const checkout = join(s.directory, "checkout");
    mkdirSync(join(checkout, "src"), { recursive: true });
    writeFileSync(join(checkout, "src", "app.ts"), "before\n");
    const project = await s.engine.openProject(checkout);
    const root = project.cwd.replace(/\\/g, "/");
    const run = async (command: string, args: Record<string, unknown>) =>
      (await s.call("workspace.run", { command, args })).value;

    expect((await run("list_dir", { path: root })).result).toEqual([
      { name: "src", path: `${root}/src`, isDir: true, ignored: false },
    ]);
    expect((await run("read_text_file", { path: `${root}/src/app.ts` })).result).toBe("before\n");
    expect((await run("read_binary_file", { path: `${root}/src/app.ts` })).result).toBe(
      Buffer.from("before\n").toString("base64"),
    );
    await run("write_text_file", {
      path: `${root}/src/app.ts`,
      content: "after\n",
    });
    expect((await run("read_text_file", { path: `${root}/src/app.ts` })).result).toBe("after\n");
    const [stat] = (await run("stat_files", { paths: [`${root}/src/app.ts`, `${root}/nope`] }))
      .result;
    expect(stat).toMatchObject({ path: `${root}/src/app.ts` });
    expect(typeof stat.mtimeMs).toBe("number");

    expect(
      (
        await run("create_path", {
          parent: root,
          name: "docs/a.md",
          isDir: false,
        })
      ).result,
    ).toBe(`${root}/docs/a.md`);
    expect(
      (
        await run("create_path", {
          parent: root,
          name: "docs/a.md",
          isDir: false,
        })
      ).error,
    ).toContain("already exists");
    expect((await run("rename_path", { path: `${root}/docs/a.md`, name: "b.md" })).result).toBe(
      `${root}/docs/b.md`,
    );
    expect(
      (
        await run("copy_path", {
          from: `${root}/docs/b.md`,
          destParent: `${root}/docs`,
        })
      ).result,
    ).toBe(`${root}/docs/b copy.md`);
    expect(
      (
        await run("move_path", {
          from: `${root}/docs/b.md`,
          destParent: `${root}/src`,
        })
      ).result,
    ).toBe(`${root}/src/b.md`);
    await run("delete_path", { path: `${root}/docs` });
    expect(
      (await run("list_project_files", { cwd: root })).result
        .map((file: { relative: string }) => file.relative)
        .sort(),
    ).toEqual(["src/app.ts", "src/b.md"]);
    expect(
      (await s.call("files.index", { projectId: project.id, cwd: root })).value.result,
    ).toEqual(["src/app.ts", "src/b.md"]);

    const git = (...args: string[]) => execFileSync("git", args, { cwd: root });
    git("init", "-q");
    git("config", "user.name", "Host Test");
    git("config", "user.email", "host@example.test");
    git("add", "src");
    git("commit", "-qm", "initial");
    writeFileSync(join(root, "src", "app.ts"), "changed\n");
    expect(
      (
        await run("search_project", {
          options: { cwd: root, query: "changed" },
        })
      ).result.matches,
    ).toContainEqual(
      expect.objectContaining({
        path: `${root}/src/app.ts`,
        relative: "src/app.ts",
        line: 1,
      }),
    );
    const gitIndex = (await run("git_diff_index", { cwd: root })).result;
    expect(gitIndex.files).toContainEqual(
      expect.objectContaining({
        path: "src/app.ts",
        relative: "src/app.ts",
        unstaged: true,
      }),
    );
    expect(
      (
        await run("git_file_diff", {
          cwd: root,
          relative: "src/app.ts",
          staged: false,
        })
      ).result,
    ).toMatchObject({ original: "after\n", current: "changed\n" });
    await run("git_stage_file", { cwd: root, relative: "src/app.ts" });
    expect((await run("git_diff_index", { cwd: root })).result.files).toContainEqual(
      expect.objectContaining({ relative: "src/app.ts", staged: true }),
    );
    const history = (await run("git_history", { cwd: root, limit: 10 })).result;
    expect(history.commits[0]).toMatchObject({
      subject: "initial",
      head: true,
    });
    expect(history.commits[0].timestamp).toBeLessThan(10_000_000_000);
    expect((await run("git_commit_files", { cwd: root, sha: history.head })).result).toContainEqual(
      expect.objectContaining({ relative: "src/app.ts", additions: 1 }),
    );
    expect(
      (
        await run("git_commit_file_diff", {
          cwd: root,
          sha: history.head,
          relative: "src/app.ts",
        })
      ).result,
    ).toMatchObject({ original: "", current: "after\n", status: "added" });
    expect((await run("git_worktrees", { cwd: root })).result.worktrees).toContainEqual(
      expect.objectContaining({ path: project.cwd, isMain: true }),
    );

    for (const path of [outside, `${root}/../outside`, `${root}/.git/config`])
      expect((await run("read_text_file", { path })).error).toBeTruthy();
    expect(
      (await run("write_text_file", { path: join(outside, "x"), content: "x" })).error,
    ).toContain("outside");
    expect((await run("delete_path", { path: root })).error).toBeTruthy();
    expect((await run("rm_rf", { path: root })).error).toContain("Unsupported");
  });

  it("browses and commits changes in the host checkout", async () => {
    const s = await setup();
    const checkout = join(s.directory, "checkout");
    mkdirSync(checkout);
    const project = await s.engine.openProject(checkout);
    const git = (...args: string[]) => execFileSync("git", args, { cwd: checkout });
    git("init", "-q");
    git("config", "user.name", "Host Test");
    git("config", "user.email", "host@example.test");
    mkdirSync(join(checkout, "src"));
    writeFileSync(join(checkout, "src", "app.ts"), "before\n");
    git("add", "--", ".");
    git("commit", "-qm", "initial");
    writeFileSync(join(checkout, "src", "app.ts"), "after\n");
    writeFileSync(join(checkout, "new.ts"), "new\n");

    const root = await s.call("files.list", {
      projectId: project.id,
      path: "",
    });
    expect(root.status).toBe(200);
    expect(root.value.result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "src", isDir: true }),
        expect.objectContaining({ name: "new.ts", isDir: false }),
      ]),
    );
    expect(
      (
        await s.call("files.search", {
          projectId: project.id,
          query: "app",
        })
      ).value.result,
    ).toEqual([expect.objectContaining({ path: "src/app.ts" })]);
    expect(
      (
        await s.call("files.searchContent", {
          projectId: project.id,
          query: "after",
        })
      ).value.result,
    ).toMatchObject({
      matches: [expect.objectContaining({ relative: "src/app.ts", line: 1 })],
      truncated: false,
    });
    expect(
      (await s.call("files.list", { projectId: project.id, path: "src" })).value.result[0].name,
    ).toBe("app.ts");
    expect(
      (await s.call("files.list", { projectId: project.id, path: ".." })).value.error,
    ).toContain("outside");
    expect(
      (
        await s.call("files.list", {
          projectId: project.id,
          cwd: s.directory,
          path: "",
        })
      ).value.error,
    ).toContain("worktree");

    const index = await s.call("git.index", { projectId: project.id });
    expect(index.value.result.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relative: "src/app.ts",
          status: "modified",
          unstaged: true,
        }),
        expect.objectContaining({
          relative: "new.ts",
          status: "untracked",
          unstaged: true,
        }),
      ]),
    );
    const diff = await s.call("git.fileDiff", {
      projectId: project.id,
      path: "src/app.ts",
      staged: false,
    });
    expect(diff.value.result).toMatchObject({
      original: "before\n",
      current: "after\n",
    });
    expect(
      (
        await s.call("git.action", {
          projectId: project.id,
          action: "stage",
          path: "../escape",
        })
      ).value.error,
    ).toContain("outside");
    expect(
      (
        await s.call("git.action", {
          projectId: project.id,
          action: "stageContents",
          path: "src/app.ts",
          content: "selected\n",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await s.call("git.fileDiff", {
          projectId: project.id,
          path: "src/app.ts",
          staged: true,
        })
      ).value.result.current,
    ).toBe("selected\n");
    expect(
      (
        await s.call("git.action", {
          projectId: project.id,
          action: "stageAll",
        })
      ).status,
    ).toBe(200);
    const staged = await s.call("git.index", { projectId: project.id });
    expect(staged.value.result.files.every((file: { staged: boolean }) => file.staged)).toBe(true);
    expect(
      (
        await s.call("git.action", {
          projectId: project.id,
          action: "commit",
          message: "remote commit",
        })
      ).status,
    ).toBe(200);
    expect((await s.call("git.index", { projectId: project.id })).value.result.files).toEqual([]);
  });
  it("answers the git.actions commands, advertised as a capability", async () => {
    const s = await setup();
    expect((await s.call("environment.describe")).value.result.capabilities).toEqual(
      expect.arrayContaining(["git.actions", "git.conflicts"]),
    );
    const checkout = join(s.directory, "actions");
    mkdirSync(checkout);
    const git = (...args: string[]) =>
      execFileSync("git", args, { cwd: checkout, encoding: "utf8" }).trim();
    git("init", "-q");
    git("checkout", "-q", "-b", "main");
    git("config", "user.name", "Test");
    git("config", "user.email", "test@example.test");
    git("config", "commit.gpgsign", "false");
    writeFileSync(join(checkout, "a.txt"), "one\n");
    git("add", "a.txt");
    git("commit", "-q", "-m", "first");
    const head = git("rev-parse", "HEAD");
    const project = await s.engine.openProject(checkout);
    const cwd = project.cwd.replace(/\\/g, "/");
    const run = async (command: string, args: Record<string, unknown> = {}) =>
      (await s.call("workspace.run", { command, args: { cwd, ...args } })).value;

    expect((await run("git_tags")).result).toEqual([]);
    expect((await run("git_create_tag", { name: "v1", sha: head })).error).toBeUndefined();
    expect((await run("git_tags")).result).toEqual(["v1"]);
    expect((await run("git_operation_status")).result).toEqual({
      operation: null,
      conflicts: [],
    });
    expect((await run("git_blame", { relative: "a.txt" })).result).toHaveLength(1);
    // Nothing is conflicted: the index says so, and there is nothing to compare.
    expect((await run("git_diff_index")).result).toMatchObject({
      conflicts: [],
      operation: null,
    });
    expect((await run("git_conflict_stages", { relative: "a.txt" })).error).toContain(
      "no merge conflict",
    );
    expect((await run("git_reset", { sha: "--hard", mode: "hard" })).error).toBe("Invalid commit");
    expect((await run("git_blame", { relative: "../a.txt" })).error).toContain("outside");

    // History: the default graph follows HEAD; `all` adds other branches.
    git("checkout", "-q", "-b", "side");
    writeFileSync(join(checkout, "b.txt"), "side\n");
    git("add", "b.txt");
    git("commit", "-q", "-m", "side work");
    git("checkout", "-q", "main");
    const subjects = async (all: boolean) =>
      (await run("git_history", { all })).result.commits.map(
        (commit: { subject: string }) => commit.subject,
      );
    expect(await subjects(false)).toEqual(["first"]);
    expect(await subjects(true)).toEqual(["side work", "first"]);

    // Commit sign-off.
    writeFileSync(join(checkout, "a.txt"), "two\n");
    git("add", "a.txt");
    expect(
      (
        await run("git_commit", {
          message: "signed",
          amend: false,
          signoff: true,
        })
      ).error,
    ).toBeUndefined();
    expect(git("log", "-1", "--format=%B")).toContain("Signed-off-by: Test <test@example.test>");

    // Only folders of this host's projects are served.
    const outside = mkdtempSync(join(tmpdir(), "bycoda-outside-"));
    cleanups.push(async () => rmSync(outside, { recursive: true, force: true }));
    const refused = (
      await s.call("workspace.run", {
        command: "git_tags",
        args: { cwd: outside.replace(/\\/g, "/") },
      })
    ).value;
    expect(refused.error).toContain("outside");

    // Like a branch switch, rewriting history waits for running sessions.
    await expect(
      s.engine.withIdleProject(
        project.id,
        async () => (await run("git_reset", { sha: head, mode: "soft" })).error,
      ),
    ).resolves.toBe("A branch switch is already in progress");
    expect((await run("git_reset", { sha: head, mode: "soft" })).error).toBeUndefined();
  });

  it("accepts sync pushes and pulls, rejecting a stale push", async () => {
    const s = await setup();
    const pushed = await s.call("sync.push", {
      ops: [
        {
          table: "group",
          id: "g1",
          baseRev: 0,
          value: { id: "g1", name: "Work", collapsed: false },
        },
      ],
    });
    expect(pushed.value.result.applied).toEqual([
      { table: "group", id: "g1", rev: pushed.value.result.rev },
    ]);

    const pulled = await s.call("sync.pull", { sinceRev: 0 });
    expect(pulled.value.result.records).toEqual([
      {
        table: "group",
        id: "g1",
        rev: pushed.value.result.rev,
        value: { id: "g1", name: "Work", collapsed: false },
      },
    ]);

    const stale = await s.call("sync.push", {
      ops: [
        {
          table: "group",
          id: "g1",
          baseRev: 0,
          value: { id: "g1", name: "Renamed", collapsed: false },
        },
      ],
    });
    expect(stale.value.result.applied).toEqual([]);
    expect(stale.value.result.rejected).toHaveLength(1);
  });

  it("skips a malformed sync op without failing the rest of the push", async () => {
    const s = await setup();
    const pushed = await s.call("sync.push", {
      ops: [
        {
          table: "group",
          id: "g9",
          baseRev: 0,
          value: { id: "g9", name: "Kept", collapsed: false },
        },
        null,
      ],
    });
    expect(pushed.status).toBe(200);
    expect(pushed.value.result.applied).toHaveLength(1);
    expect(pushed.value.result.rejected).toEqual([]);

    const pulled = await s.call("sync.pull", { sinceRev: 0 });
    expect(JSON.stringify(pulled.value.result.records)).toContain("g9");
  });

  it("advertises the sync capability", async () => {
    const s = await setup();
    const described = await s.call("environment.describe");
    expect(described.value.result.capabilities).toContain("sync");
  });

  it("two desktops converge on the same group after a disconnect with edits on both sides", async () => {
    const s = await setup();
    // Desktop A pushes a new group.
    const a = await s.call("sync.push", {
      ops: [
        {
          table: "group",
          id: "g1",
          baseRev: 0,
          value: { id: "g1", name: "From A", collapsed: false },
        },
      ],
    });
    expect(a.value.result.rejected).toEqual([]);

    // Desktop B, still at revision 0, pulls and catches up.
    const bPull = await s.call("sync.pull", { sinceRev: 0 });
    expect(bPull.value.result.records).toHaveLength(1);
    const bRev = bPull.value.result.rev;

    // Both edit the same group while "disconnected" from each other (each
    // still believes the revision it last pulled).
    const bPush = await s.call("sync.push", {
      ops: [
        {
          table: "group",
          id: "g1",
          baseRev: bRev,
          value: { id: "g1", name: "From B", collapsed: false },
        },
      ],
    });
    expect(bPush.value.result.applied).toHaveLength(1);

    // A, still at the revision from its own first push, tries to edit too —
    // this is the "concurrent edit" case: A's base revision is now stale.
    const aRetry = await s.call("sync.push", {
      ops: [
        {
          table: "group",
          id: "g1",
          baseRev: a.value.result.applied[0].rev,
          value: { id: "g1", name: "From A again", collapsed: false },
        },
      ],
    });
    expect(aRetry.value.result.rejected).toHaveLength(1);
    const winning = aRetry.value.result.rejected[0].current;

    // Both sides pull and land on the same value: whichever write actually
    // reached the host last (B's).
    const finalPull = await s.call("sync.pull", { sinceRev: 0 });
    const finalGroup = finalPull.value.result.records.find((r: any) => r.id === "g1");
    expect(finalGroup.value).toEqual(winning.value);
    expect(finalGroup.value.name).toBe("From B");
  });

  it("answers the task board commands, advertised as a capability", async () => {
    const s = await setup();
    expect((await s.call("environment.describe")).value.result.capabilities).toContain("tasks");
    expect((await s.call("environment.describe")).value.result.capabilities).toContain(
      "tasks.todo",
    );
    const task = {
      id: "main",
      title: "Ship the report",
      prompt: "Write the weekly report",
      projectId: s.project.id,
      harness: "codex",
      model: "codex:test",
      runtimeMode: "auto",
    };
    const saved = await s.call("tasks.save", { task });
    expect(saved.value.result).toMatchObject({ id: "main", status: "queued" });
    expect((await s.call("tasks.list")).value.result).toEqual([saved.value.result]);
    const refused = await s.call("tasks.move", { taskId: "main", to: "done" });
    expect(refused.value.error).toBe("A queued task cannot be moved to done.");
    const todo = await s.call("tasks.save", {
      task: { ...task, id: "idea", prompt: "", status: "todo" },
    });
    expect(todo.value.result).toMatchObject({ id: "idea", status: "todo" });
    expect((await s.call("tasks.move", { taskId: "idea", to: "queued" })).value.error).toBe(
      "Add a description before starting this task with an agent.",
    );
    await s.call("tasks.delete", { taskId: "idea" });
    expect((await s.call("tasks.delete", { taskId: "main" })).value.result).toEqual({
      deleted: true,
    });
    expect((await s.call("tasks.list")).value.result).toEqual([]);
  });

  it("routes review note read and resolve updates without completing the task", async () => {
    const s = await setup();
    expect((await s.call("environment.describe")).value.result.capabilities).toContain(
      "tasks.notes",
    );
    expect((await s.call("environment.describe")).value.result.capabilities).toContain(
      "tasks.review-recheck",
    );
    const saved = (
      await s.call("tasks.save", {
        task: {
          id: "notes",
          title: "Ship the report",
          prompt: "Write it",
          projectId: s.project.id,
          harness: "codex",
          model: "codex:test",
          runtimeMode: "auto",
          status: "todo",
        },
      })
    ).value.result;
    const reviewNotes = ["seen", "newer"].map((id) => ({
      id,
      finding: id,
      kind: "finding",
      createdAt: 1,
      updatedAt: 1,
      occurrences: 1,
    }));
    s.store.db
      .prepare("UPDATE tasks SET value=? WHERE id=?")
      .run(JSON.stringify({ ...saved, reviewNotes }), saved.id);
    const read = (await s.call("tasks.notes.read", { taskId: saved.id, noteIds: ["seen"] })).value
      .result;
    expect(read.reviewNotes[0].readAt).toEqual(expect.any(Number));
    expect(read.reviewNotes[1].readAt).toBeUndefined();
    const fixed = (
      await s.call("tasks.notes.resolve", {
        taskId: saved.id,
        noteId: "seen",
        resolved: true,
      })
    ).value.result;
    expect(fixed.status).toBe("todo");
    expect(fixed.reviewNotes[0].resolvedAt).toEqual(expect.any(Number));
    expect(
      (
        await s.call("tasks.notes.resolve", {
          taskId: saved.id,
          noteId: "missing",
          resolved: true,
        })
      ).value.error,
    ).toBe("Review note not found.");
    const reopened = (
      await s.call("tasks.notes.resolve", {
        taskId: saved.id,
        noteId: "seen",
        resolved: false,
      })
    ).value.result;
    expect(reopened.reviewNotes[0].resolvedAt).toBeUndefined();
    expect((await s.call("tasks.list")).value.result[0].reviewNotes).toEqual(reopened.reviewNotes);
    expect((await s.call("tasks.review.recheck", { taskId: saved.id })).value.error).toContain(
      "Only a blocked task",
    );
  });

  it("answers the goal commands, advertised as a capability", async () => {
    const s = await setup();
    expect((await s.call("environment.describe")).value.result.capabilities).toContain("goals");
    expect((await s.call("environment.describe")).value.result.capabilities).toContain(
      "goals.direct-checkout",
    );
    const goal = {
      id: "launch",
      title: "Launch the beta",
      prompt: "Ship the beta",
      projectIds: [s.project.id],
      leadProjectId: s.project.id,
      harness: "codex",
      model: "codex:test",
      runtimeMode: "auto",
    };
    const created = await s.call("goals.create", { goal });
    expect(created.value.result).toMatchObject({
      id: "launch",
      status: "planning",
      taskIds: [],
    });
    expect((await s.call("goals.list")).value.result).toMatchObject([
      { id: "launch", status: "planning" },
    ]);
    const refused = await s.call("goals.approve", { goalId: "launch" });
    expect(refused.value.error).toBe("Only a plan waiting for approval can be approved.");
    expect((await s.call("goals.replan", { goalId: "launch" })).value.error).toBe(
      "Only a goal whose plan was not started can be planned again.",
    );
    expect((await s.call("goals.cancel", { goalId: "launch" })).value.result).toMatchObject({
      status: "cancelled",
    });
    expect((await s.call("goals.delete", { goalId: "launch" })).value.result).toEqual({
      deleted: true,
    });
    expect((await s.call("goals.list")).value.result).toEqual([]);
  });
});

describe("host settings commands", () => {
  it("answers host.settings.get and save, advertised as a capability", async () => {
    const s = await setup();
    expect((await s.call("environment.describe")).value.result.capabilities).toContain(
      "host.settings",
    );
    expect((await s.call("host.settings.get")).value.result).toEqual({
      maxRunningTasks: 2,
      dailyAgentMinutes: 0,
      usedMinutes: 0,
      limitReached: false,
    });
    const saved = await s.call("host.settings.save", {
      settings: { maxRunningTasks: 4, dailyAgentMinutes: 240 },
    });
    expect(saved.value.result).toMatchObject({
      maxRunningTasks: 4,
      dailyAgentMinutes: 240,
      limitReached: false,
    });
    expect((await s.call("host.settings.get")).value.result).toMatchObject({
      maxRunningTasks: 4,
      dailyAgentMinutes: 240,
    });
    expect(
      (await s.call("host.settings.save", { settings: { maxRunningTasks: 9 } })).value.error,
    ).toBe("Invalid concurrent task limit");
  });
});
