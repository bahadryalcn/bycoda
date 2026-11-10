import { afterEach, describe, expect, it, vi } from "vitest";
import { createVoiceWorkspaceActions } from "./useVoiceWorkspaceActions";
import { createVoiceInspectPorts } from "./voiceInspectPorts";
import { APP_UI_SETTINGS, APP_UI_VIEWS, registerAppUiControl } from "../../model/appUiControl";
import type { VoiceWorkspaceActionsDeps } from "../../../features/voice/model/voiceWorkspaceActions";
import type { Session } from "../../../features/sessions/model/session";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

function setup(inspect: VoiceWorkspaceActionsDeps["inspect"] = {}) {
  const deps: VoiceWorkspaceActionsDeps = {
    getProjects: () => [{ path: "/project" }],
    getSessions: () => [],
    getActiveSessionId: () => "first",
    getProjectPath: () => "/project",
    inspect,
  };
  return createVoiceWorkspaceActions(() => deps);
}

let unregister: (() => void) | undefined;
afterEach(() => unregister?.());

describe("voice workspace inspect tools", () => {
  it("lists the four tools under the workspace tool list with registry enums", () => {
    const { tools } = setup();
    const names = tools.map((tool) => tool.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "workspace.views.open",
        "workspace.search.query",
        "workspace.today.read",
        "workspace.mcp.status",
      ]),
    );
    const open = tools.find((tool) => tool.name === "workspace.views.open")!;
    const props = open.parameters.properties as Record<string, { enum: string[] }>;
    expect(props.view.enum).toEqual(
      APP_UI_VIEWS.filter((view) => view !== "files" && view !== "terminal"),
    );
    expect(props.section.enum).toEqual([...APP_UI_SETTINGS]);
  });

  it("rejects unknown views and sections with the allowed list and never navigates", async () => {
    const navigate = vi.fn();
    const { execute } = setup({ navigate });
    const bad = await execute("workspace.views.open", { view: "nowhere" });
    expect(bad.status).toBe("rejected");
    expect(bad.error).toContain("Allowed views:");
    expect(bad.error).toContain("settings");
    const section = await execute("workspace.views.open", { view: "settings", section: "bogus" });
    expect(section.status).toBe("rejected");
    expect(section.error).toContain("Allowed sections:");
    expect((await execute("workspace.views.open", { view: "tasks", section: "mcp" })).status).toBe(
      "rejected",
    );
    expect(navigate).not.toHaveBeenCalled();
  });

  it("navigates through the real app navigator with exact ids and nothing else", async () => {
    const calls: unknown[][] = [];
    unregister = registerAppUiControl(async (...args) => {
      calls.push(args);
      return {};
    });
    const session = { id: "first", cwd: "/project", title: "First" } as Session;
    const inspect = createVoiceInspectPorts(() => ({
      projects: [{ path: "/project" }],
      sessions: [session],
      projectPath: "/project",
      activeId: "first",
    }));
    const { execute } = setup(inspect);
    expect(await execute("workspace.views.open", { view: "settings", section: "mcp" })).toEqual({
      action: "workspace.views.open",
      status: "completed",
      view: "settings",
      section: "mcp",
    });
    expect(calls).toEqual([
      [
        { cwd: "/project", sessionId: "first", title: "First" },
        "ui.workspace.open",
        { view: "settings", section: "mcp" },
      ],
    ]);
  });

  it("refuses navigation from a locked or missing source conversation", async () => {
    const calls = vi.fn(async () => ({}));
    unregister = registerAppUiControl(calls);
    const session = { id: "first", cwd: "/locked", title: "First" } as Session;
    const inspect = createVoiceInspectPorts(() => ({
      projects: [{ path: "/project" }],
      sessions: [session],
      projectPath: "/project",
      activeId: "first",
    }));
    const { execute } = setup(inspect);
    expect((await execute("workspace.views.open", { view: "inbox" })).status).toBe("rejected");
    expect(calls).not.toHaveBeenCalled();
  });

  it("bounds search, drops locked projects and returns openable targets", async () => {
    const many = Array.from({ length: 50 }, (_, index) => ({
      kind: "session" as const,
      title: `Match ${index}`,
      projectPath: "/project",
      sessionId: `s${index}`,
      score: index,
    }));
    const search = vi.fn(async () => ({
      hits: [
        ...many,
        {
          kind: "session" as const,
          title: "Secret",
          projectPath: "/locked",
          sessionId: "x",
          score: 999,
        },
        { kind: "project" as const, title: "project", projectPath: "/project", score: 500 },
      ],
    }));
    const { execute } = setup({ search });
    const result = await execute("workspace.search.query", { query: "match", limit: 5 });
    const results = result.results as Array<{ title: string; target: Record<string, string> }>;
    expect(results).toHaveLength(5);
    expect(JSON.stringify(results)).not.toContain("Secret");
    expect(results[0]).toMatchObject({
      kind: "project",
      target: { action: "workspace.projects.select", projectPath: "/project" },
    });
    expect(results[1].target).toEqual({
      action: "workspace.sessions.open",
      sessionId: "s49",
      projectPath: "/project",
    });
    expect((await execute("workspace.search.query", { query: "a", limit: 21 })).status).toBe(
      "rejected",
    );
  });

  it("caps Today items at 30", async () => {
    const day = { key: "2026-01-01", start: 0, cost: 1, runMs: 1, sessions: 1, unpricedTokens: 0 };
    const project = (n: number) => ({
      key: `p${n}`,
      label: `P${n}`,
      path: "/secret/path",
      cost: 1,
      runMs: 5,
      sessions: 2,
      unpricedTokens: 0,
      titles: ["private title"],
    });
    const today = vi.fn(async () => ({
      data: {
        period: "today" as const,
        window: { start: 0, end: 1 },
        totals: { cost: 40, runMs: 200, sessions: 80, unpricedTokens: 0 },
        projects: Array.from({ length: 40 }, (_, n) => project(n)),
        days: [day],
      },
    }));
    const { execute } = setup({ today });
    const result = await execute("workspace.today.read", {});
    expect(result.items).toHaveLength(30);
    expect(result.truncated).toBe(true);
    expect(JSON.stringify(result)).not.toContain("/secret/path");
    expect(JSON.stringify(result)).not.toContain("private title");
  });

  it("reports MCP status without commands, env values, headers or tokens", async () => {
    const row = {
      provider: "Codex",
      name: "docs",
      scope: "user",
      transport: "stdio",
      enabled: true,
      status: "Connected",
      command: "/usr/bin/node --token=abc",
      env: { API_KEY: "sk-secret" },
      headers: { Authorization: "Bearer secret" },
      configPath: "/home/me/.codex/config.toml",
    };
    const { execute } = setup({ mcp: async () => ({ servers: [row] }) });
    const result = await execute("workspace.mcp.status", {});
    expect(result.servers).toEqual([
      {
        name: "docs",
        provider: "Codex",
        scope: "user",
        transport: "stdio",
        enabled: true,
        status: "Connected",
      },
    ]);
    const text = JSON.stringify(result);
    for (const secret of ["sk-secret", "Bearer", "--token", "config.toml", "/usr/bin"])
      expect(text).not.toContain(secret);
  });
});
