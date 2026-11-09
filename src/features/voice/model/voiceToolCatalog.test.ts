import { describe, expect, it } from "vitest";
import { voiceToolCatalog } from "../../../../host/voice/voice-tools";
import {
  readVoiceToolCatalog,
  selectVoiceTools,
  VOICE_TOOL_MAX_LIMIT,
  type VoiceToolDescriptor,
} from "./voiceToolCatalog";

const tool = (action: string, family: VoiceToolDescriptor["family"] = "conversation") => ({
  family,
  action,
  name: `${family.replaceAll("-", "_")}_${action.replaceAll(".", "_")}`,
  description: `${action} preserves owner approval.`,
  inputSchema: { type: "object", additionalProperties: false },
});

describe("voice tool discovery", () => {
  it("accepts every tool the Host advertises, including hyphenated actions", () => {
    // One rejected entry discards the whole catalog, leaving voice without tools.
    const catalog = voiceToolCatalog();
    expect(readVoiceToolCatalog({ tools: catalog })).toHaveLength(catalog.length);
    expect(catalog.some((entry) => entry.action === "programs.preview-schedule")).toBe(true);
    for (const bad of ["-lead", "a..b", "a.-b", "a b", "a/b"])
      expect(() => readVoiceToolCatalog({ tools: [tool(bad)] })).toThrow();
  });

  it("keeps similarly named tools in different authorization families separate", () => {
    const catalog = readVoiceToolCatalog({
      tools: [tool("inbox.list"), tool("inbox.list", "social"), tool("read", "runtime-logs")],
    });
    expect(selectVoiceTools(catalog, { family: "social" }).tools).toEqual([
      tool("inbox.list", "social"),
    ]);
    expect(selectVoiceTools(catalog, { category: "runtime-logs:read" }).tools).toEqual([
      tool("read", "runtime-logs"),
    ]);
  });

  it("returns a bounded page with a continuation and keeps other domains discoverable", () => {
    const catalog = Array.from({ length: 55 }, (_, i) => tool(`notes.operation${i}`));
    catalog.push(tool("automations.pause"));
    const first = selectVoiceTools(catalog, { query: "notes owner", limit: 40 });
    expect(first.tools).toHaveLength(40);
    expect(first.total).toBe(55);
    expect(first.nextOffset).toBe(40);
    expect(first.categories).toContain("conversation:automations");
    const second = selectVoiceTools(catalog, { query: "notes owner", offset: first.nextOffset! });
    expect(second.tools[0].action).toBe("notes.operation40");
    expect(selectVoiceTools(catalog, { query: "missing" })).toMatchObject({
      tools: [],
      total: 0,
      nextOffset: null,
    });
  });

  it("drops spoken filler words only when the whole phrase matches nothing", () => {
    const catalog = [tool("crews.start"), tool("crews.list"), tool("notes.list")];
    // "yönetimi" (management) appears in no tool metadata; "ekip" is the Crews feature.
    const relaxed = selectVoiceTools(catalog, { query: "ekip yönetimi" });
    expect(relaxed.tools.map((entry) => entry.action)).toEqual(["crews.start", "crews.list"]);
    expect(relaxed.ignoredTerms).toEqual(["yonetimi"]);
    // A full match keeps the strict result and reports nothing ignored.
    const strict = selectVoiceTools(catalog, { query: "crews start" });
    expect(strict.tools.map((entry) => entry.action)).toEqual(["crews.start"]);
    expect(strict.ignoredTerms).toBeUndefined();
    // Unrecognized words alone never widen into an unrelated catalog.
    expect(selectVoiceTools(catalog, { query: "missing words" }).total).toBe(0);
  });

  it("finds the dev server start tool for spoken run-locally requests", () => {
    // Global voice once told the owner it had no run tool because these searches found nothing.
    const catalog = readVoiceToolCatalog({ tools: voiceToolCatalog() });
    for (const query of [
      "dev sunucusu",
      "dev server",
      "localhost",
      "localhost başlat",
      "lokal sunucu",
      "dev sunucusunu başlat",
      "sunucuyu çalıştır",
      "ayağa kaldır",
    ])
      expect(
        selectVoiceTools(catalog, { query }).tools.map((entry) => entry.action),
        query,
      ).toContain("devServers.start");
  });

  it("maps Turkish cancel, git and desktop speech to their features", () => {
    // Synthetic: the Host advertises no tasks cancel tool yet, so this checks the mapping only.
    const tasks = [tool("tasks.cancel"), tool("tasks.list")];
    expect(
      selectVoiceTools(tasks, { query: "görevi iptal et" }).tools.map((t) => t.action),
    ).toEqual(["tasks.cancel"]);
    const catalog = readVoiceToolCatalog({ tools: voiceToolCatalog() });
    expect(
      selectVoiceTools(catalog, { query: "git değişikliklerini" }).tools.map((t) => t.action),
    ).toContain("git.status");
    expect(selectVoiceTools(catalog, { query: "ekrana bak" }).tools.map((t) => t.action)).toContain(
      "desktop.status",
    );
  });

  it("ranks exact and action-word matches before family and description matches", () => {
    const catalog = [
      { ...tool("tasks.update"), description: "Update a task; may list its notes." },
      tool("notes.create"),
      tool("notes.list"),
      tool("notes.listArchived"),
      { ...tool("inbox.read"), description: "Reads inbox items and notes list." },
    ];
    const ranked = selectVoiceTools(catalog, { query: "notes list" }).tools.map((t) => t.action);
    expect(ranked[0]).toBe("notes.list");
    expect(ranked.indexOf("notes.list")).toBeLessThan(ranked.indexOf("notes.listArchived"));
    expect(VOICE_TOOL_MAX_LIMIT).toBe(40);
  });

  it("does not disguise incomplete or malformed catalogs as an empty available set", () => {
    expect(() => readVoiceToolCatalog({ unavailable: true })).toThrow("catalog is invalid");
    expect(() => readVoiceToolCatalog({ tools: [tool("notes.list"), tool("notes.list")] })).toThrow(
      "duplicate",
    );
    expect(() =>
      readVoiceToolCatalog({ tools: [{ ...tool("notes.list"), family: "shell" }] }),
    ).toThrow("invalid tool");
    expect(() =>
      readVoiceToolCatalog({ tools: [{ ...tool("notes.list"), inputSchema: [] }] }),
    ).toThrow("invalid tool");
  });

  it("normalizes invalid page bounds without generating an unbounded model payload", () => {
    const catalog = Array.from({ length: 60 }, (_, i) => tool(`notes.operation${i}`));
    expect(selectVoiceTools(catalog, { limit: Infinity }).tools).toHaveLength(12);
    expect(selectVoiceTools(catalog, { limit: 5000, offset: -10 }).tools).toHaveLength(40);
    expect(selectVoiceTools(catalog, { offset: 1000 }).tools).toEqual([]);
  });

  it("discovers localized features and synonymous Turkish and English words without changing scope", () => {
    const catalog = [
      tool("crews.list"),
      tool("crews.create"),
      tool("tasks.list"),
      tool("inbox.list", "social"),
    ];
    for (const query of [
      "ekipleri",
      "ekiplerim",
      "ekipteki",
      "crew'ler",
      "takımlar",
      "kru",
      "クルー",
      "小队",
      "équipe",
      "equipo",
    ]) {
      expect(selectVoiceTools(catalog, { query }).tools.map((item) => item.action)).toEqual([
        "crews.list",
        "crews.create",
      ]);
    }
    expect(
      selectVoiceTools(catalog, { query: "ekip crew listele" }).tools.map((item) => item.action),
    ).toEqual(["crews.list"]);
    for (const query of ["ekipleri listele", "ekipteki listele", "crew'ler listele"]) {
      expect(selectVoiceTools(catalog, { query }).tools.map((item) => item.action)).toEqual([
        "crews.list",
      ]);
    }
    expect(
      selectVoiceTools(catalog, { query: "ekip oluştur" }).tools.map((item) => item.action),
    ).toEqual(["crews.create"]);
    expect(selectVoiceTools(catalog, { query: "Kree" }).tools).toEqual([]);
    expect(selectVoiceTools(catalog, { query: "ekip", family: "social" }).tools).toEqual([]);
    expect(
      selectVoiceTools(catalog, { query: "ekip", category: "conversation:tasks" }).tools,
    ).toEqual([]);
  });

  it("covers UI feature labels from every supported locale", async () => {
    const locales = await Promise.all([
      import("../../../shared/i18n/locales/en.json"),
      import("../../../shared/i18n/locales/tr.json"),
      import("../../../shared/i18n/locales/de.json"),
      import("../../../shared/i18n/locales/es.json"),
      import("../../../shared/i18n/locales/fr.json"),
      import("../../../shared/i18n/locales/ja.json"),
      import("../../../shared/i18n/locales/pt.json"),
      import("../../../shared/i18n/locales/zh-CN.json"),
    ]);
    const labels = {
      Crew: "crews",
      Crews: "crews",
      Tasks: "tasks",
      Notes: "notes",
      Projects: "projects",
      Inbox: "inbox",
      Archive: "archive",
      Settings: "settings",
      Servers: "servers",
      Search: "search",
      Sessions: "sessions",
      Automations: "automations",
      Logs: "logs",
      Goals: "goals",
      Skills: "skills",
      Providers: "providers",
      Terminals: "terminals",
      Terminal: "terminals",
      Usage: "usage",
      Devices: "devices",
      Browser: "browser",
      Files: "files",
      Models: "models",
      Agents: "agents",
      Jobs: "jobs",
      Assistant: "assistant",
      Notifications: "notifications",
      MCP: "mcp",
    } as const;
    for (const locale of locales)
      for (const [label, category] of Object.entries(labels)) {
        const catalog = [tool(`${category}.list`)];
        expect(
          selectVoiceTools(catalog, { query: locale.default[label as keyof typeof labels] }).total,
          `${label}: ${locale.default[label as keyof typeof labels]}`,
        ).toBe(1);
      }
  });

  it("maps localized action labels to real catalog actions", async () => {
    const locales = await Promise.all([
      import("../../../shared/i18n/locales/en.json"),
      import("../../../shared/i18n/locales/tr.json"),
      import("../../../shared/i18n/locales/de.json"),
      import("../../../shared/i18n/locales/es.json"),
      import("../../../shared/i18n/locales/fr.json"),
      import("../../../shared/i18n/locales/ja.json"),
      import("../../../shared/i18n/locales/pt.json"),
      import("../../../shared/i18n/locales/zh-CN.json"),
    ]);
    const labels = {
      List: "list",
      Create: "create",
      Delete: "delete",
      Edit: "update",
      Update: "update",
      Start: "start",
      Stop: "stop",
      Pause: "pause",
      Resume: "resume",
      Read: "read",
    } as const;
    const catalog = voiceToolCatalog();
    for (const locale of locales)
      for (const [label, action] of Object.entries(labels)) {
        const query = locale.default[label as keyof typeof labels];
        expect(
          selectVoiceTools(catalog, { query, limit: 40 }).tools.some((item) =>
            item.action.split(".").includes(action),
          ),
          `${label}: ${query}`,
        ).toBe(true);
      }
  });

  it("finds actual advertised feature families in each UI language", async () => {
    const locales = await Promise.all([
      import("../../../shared/i18n/locales/en.json"),
      import("../../../shared/i18n/locales/tr.json"),
      import("../../../shared/i18n/locales/de.json"),
      import("../../../shared/i18n/locales/es.json"),
      import("../../../shared/i18n/locales/fr.json"),
      import("../../../shared/i18n/locales/ja.json"),
      import("../../../shared/i18n/locales/pt.json"),
      import("../../../shared/i18n/locales/zh-CN.json"),
    ]);
    const labels = {
      Crews: "crews",
      Tasks: "tasks",
      Notes: "notes",
      Sessions: "sessions",
      Automations: "automations",
      Inbox: "inbox",
      Skills: "skills",
      Devices: "devices",
      Terminals: "terminals",
      Browser: "browser",
      Logs: "logs",
    } as const;
    const catalog = voiceToolCatalog();
    for (const locale of locales)
      for (const [label, category] of Object.entries(labels)) {
        const query = locale.default[label as keyof typeof labels];
        expect(
          selectVoiceTools(catalog, { query, category: `conversation:${category}`, limit: 40 })
            .total,
          `${label}: ${query}`,
        ).toBeGreaterThan(0);
      }
  });
});
