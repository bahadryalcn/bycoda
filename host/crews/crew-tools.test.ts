import { describe, expect, it } from "vitest";
import {
  CREW_TOOLS_KEY,
  carryCrossDelegation,
  providerModelSettings,
} from "../../src/shared/model/host-contracts/delegation";
import type { CrewToolProfile } from "../../src/features/crews/model/crewTools";
import { sessionConversationToolCatalog } from "../conversation/conversation-tools";
import { withCrewTools } from "./crew-identity";
import {
  assertCrewToolAllowed,
  crewToolAllowed,
  crewToolCatalog,
  crewToolGate,
  crewToolProfileOf,
} from "./crew-tools";

const all = sessionConversationToolCatalog().map((tool) => tool.action);
const allowed = (profile: CrewToolProfile | undefined) =>
  all.filter((action) => crewToolAllowed(profile, action));

describe("presets", () => {
  it("leaves a missing profile and the code preset unchanged", () => {
    expect(allowed(undefined)).toEqual(all);
    expect(allowed({ preset: "code" })).toEqual(all);
  });

  it("read-only keeps reads and blocks Host tools that write or start things", () => {
    const names = allowed({ preset: "read-only" });
    expect(names).toEqual(expect.arrayContaining(["files.read", "tools.list", "crews.request"]));
    for (const blocked of [
      "files.write",
      "files.delete",
      "terminals.write",
      "browser.open",
      "images.generate",
      "tasks.start",
      "devServers.start",
    ])
      expect(names).not.toContain(blocked);
    expect(names.length).toBeLessThan(all.length);
  });

  it("classifies a member ask as a write and the active list as a read", () => {
    expect(allowed({ preset: "read-only" })).toContain("crews.active.list");
    expect(allowed({ preset: "read-only" })).not.toContain("crews.member.ask");
    expect(allowed({ preset: "code" })).toContain("crews.member.ask");
    const custom = allowed({ preset: "custom", conversationTools: ["crews.member.ask"] });
    expect(custom).toContain("crews.member.ask");
    expect(custom).not.toContain("crews.active.list");
  });

  it("design adds image generation and browser adds the browser group, nothing else", () => {
    const readOnly = new Set(allowed({ preset: "read-only" }));
    const design = allowed({ preset: "design" });
    expect(design).toContain("images.generate");
    expect(design).not.toContain("browser.open");
    expect(design.filter((action) => !readOnly.has(action))).toEqual(["images.generate"]);
    const browser = allowed({ preset: "browser" });
    expect(browser).toEqual(expect.arrayContaining(["browser.open", "browser.input"]));
    expect(browser).not.toContain("images.generate");
    expect(browser).not.toContain("files.write");
    expect(
      browser.filter((action) => !readOnly.has(action) && !action.startsWith("browser.")),
    ).toEqual([]);
  });

  it("combines design and browser extras as a union on read-only", () => {
    const readOnly = new Set(allowed({ preset: "read-only" }));
    const both = allowed({ preset: "read-only", extras: ["design", "browser"] });
    expect(both).toEqual(expect.arrayContaining(["images.generate", "browser.open"]));
    expect(both).not.toContain("files.write");
    expect(both.filter((a) => !readOnly.has(a) && !a.startsWith("browser."))).toEqual([
      "images.generate",
    ]);
    const mixed = allowed({ preset: "design", extras: ["browser"] });
    expect(mixed).toEqual(both);
    expect(allowed({ preset: "read-only", extras: ["browser"] })).not.toContain("images.generate");
  });

  it("custom allows only the listed actions and groups, plus discovery", () => {
    const names = allowed({
      preset: "custom",
      conversationTools: ["files.read", "browser", "devices.*"],
    });
    expect(names).toEqual(expect.arrayContaining(["files.read", "browser.open", "devices.list"]));
    expect(names).toEqual(expect.arrayContaining(["tools.list", "crews.request"]));
    expect(names).not.toContain("files.write");
    expect(names).not.toContain("terminals.write");
  });

  it("only narrows: a list cannot widen a preset", () => {
    const names = allowed({
      preset: "read-only",
      conversationTools: ["files.read", "files.write"],
    });
    expect(names).toContain("files.read");
    expect(names).not.toContain("files.write");
  });
});

describe("enforcement", () => {
  it("rejects an action outside the profile with a clear error", () => {
    expect(() => assertCrewToolAllowed({ preset: "read-only" }, "files.write")).toThrow(
      "tool profile (read-only) does not allow files.write",
    );
    expect(() => assertCrewToolAllowed({ preset: "read-only" }, "files.read")).not.toThrow();
    expect(() => assertCrewToolAllowed(undefined, "files.write")).not.toThrow();
  });

  it("reads the session setting and fails closed when it is unreadable", () => {
    const stored = withCrewTools({ effort: "high" }, { tools: { preset: "design" } });
    expect(stored.effort).toBe("high");
    expect(crewToolProfileOf(stored)).toEqual({ preset: "design" });
    expect(crewToolProfileOf({})).toBeUndefined();
    expect(crewToolProfileOf({ [CREW_TOOLS_KEY]: "{nope" })).toEqual({ preset: "read-only" });
    expect(crewToolProfileOf({ [CREW_TOOLS_KEY]: '{"preset":"root"}' })).toEqual({
      preset: "read-only",
    });
    expect(withCrewTools({ a: "1" }, {})).toEqual({ a: "1" });
  });

  let sessions = 0;
  const gate = (settings: Record<string, string> | undefined, action: string) =>
    crewToolGate(
      {
        inHost: async () => true,
        engine: { store: { session: async () => ({ session: { modelSettings: settings } }) } },
      },
      { sessionId: `s${++sessions}` },
      action,
    );

  it("gates a session call, filters discovery and leaves unscoped sessions alone", async () => {
    const readOnly = withCrewTools({}, { tools: { preset: "read-only" } });
    const filter = await gate(readOnly, "tools.list");
    expect(all.filter((action) => filter({ action })).length).toBeLessThan(all.length);
    expect(filter({ action: "files.write" })).toBe(false);
    expect(filter({ action: "logs.read", group: "runtime-logs" })).toBe(true);
    await expect(gate(readOnly, "files.read")).resolves.toBeTypeOf("function");
    await expect(gate(readOnly, "terminals.interrupt")).rejects.toThrow();
    const open = await gate(undefined, "tools.list");
    expect(all.filter((action) => open({ action }))).toEqual(all);
  });

  it("keeps the profile out of provider settings and across a model change", () => {
    const stored = withCrewTools({}, { tools: { preset: "read-only" } });
    expect(providerModelSettings(stored)).toEqual({});
    expect(carryCrossDelegation(stored, {})[CREW_TOOLS_KEY]).toBe(stored[CREW_TOOLS_KEY]);
  });

  it("snapshots the profile at session start", () => {
    const tools: CrewToolProfile = { preset: "custom", conversationTools: ["files.read"] };
    const stored = withCrewTools({}, { tools });
    tools.conversationTools!.push("files.write");
    expect(crewToolProfileOf(stored)).toEqual({
      preset: "custom",
      conversationTools: ["files.read"],
    });
  });
});

describe("catalog", () => {
  it("lists session Host tools with scope and a short summary, without the always-allowed ones", () => {
    const catalog = crewToolCatalog();
    const actions = catalog.map((tool) => tool.action);
    expect(actions).toEqual(expect.arrayContaining(["files.read", "files.write", "browser.open"]));
    expect(actions).not.toContain("tools.list");
    expect(actions).not.toContain("crews.request");
    expect(catalog.find((tool) => tool.action === "files.read")?.write).toBe(false);
    expect(catalog.find((tool) => tool.action === "files.write")?.write).toBe(true);
    for (const tool of catalog) {
      expect(tool.summary.length).toBeGreaterThan(0);
      expect(tool.summary.length).toBeLessThanOrEqual(160);
      expect(tool.summary.startsWith(`${tool.action}:`)).toBe(false);
    }
  });
});
