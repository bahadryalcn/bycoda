import { describe, expect, it, vi } from "vitest";
import type { CrewToolProfile } from "../../src/features/crews/model/crewTools";
import { buildThreadStartParams } from "../../src/integrations/harness/providers/codex/codexProtocol";
import {
  nativeReadOnly,
  NATIVE_TOOLS_KEY,
} from "../../src/integrations/harness/core/nativeToolLimits";
import { buildClaudeSpawnArgs } from "../../src/integrations/harness/providers/claude/claudeProtocol";
import { withCrewTools } from "./crew-identity";
import { crewDeniedSkills, crewMcpServers, crewNativeInput } from "./crew-native-tools";
import { withCrewNativeTools, type HostProvider } from "../providers/providers";

const settings = (tools: CrewToolProfile | undefined) =>
  withCrewTools({ effort: "high" }, { tools });
const input = (tools: CrewToolProfile | undefined, runtimeMode = "full-access") => ({
  sessionId: "s1",
  runtimeMode,
  modelSettings: settings(tools),
});

describe("native tools per provider", () => {
  it("leaves sessions without a profile or with the code preset untouched", () => {
    const plain = { sessionId: "s", runtimeMode: "full-access" };
    expect(crewNativeInput("opencode", plain)).toBe(plain);
    const code = input({ preset: "code", skills: ["a"] });
    expect(crewNativeInput("opencode", code)).toBe(code);
    const custom = input({ preset: "custom", conversationTools: ["files.read"] });
    expect(crewNativeInput("cursor", custom)).toBe(custom);
  });

  it.each(["read-only", "design", "browser"] as const)(
    "%s runs Claude and Codex read-only at the narrowest mode",
    (preset) => {
      for (const provider of ["claude", "codex"]) {
        const out = crewNativeInput(provider, input({ preset }));
        expect(out.runtimeMode).toBe("supervised");
        expect(nativeReadOnly(out.modelSettings)).toBe(true);
        expect(out.modelSettings.effort).toBe("high");
      }
    },
  );

  it("combined extras stay non-writing for Claude and Codex and fail closed elsewhere", () => {
    const combined = input({ preset: "read-only", extras: ["design", "browser"] });
    expect(nativeReadOnly(crewNativeInput("claude", combined).modelSettings)).toBe(true);
    expect(nativeReadOnly(crewNativeInput("codex", combined).modelSettings)).toBe(true);
    expect(() => crewNativeInput("cursor", combined)).toThrow(/cannot run read-only members/);
  });

  it.each(["cursor", "grok", "opencode", "pi", "omp", "fx", "hermes", "antigravity", "acp"])(
    "%s cannot run read-only members and fails closed",
    (provider) => {
      expect(() => crewNativeInput(provider, input({ preset: "read-only" }))).toThrow(
        /cannot run read-only members/,
      );
    },
  );

  it("an unreadable stored profile fails closed to read-only", () => {
    const broken = { sessionId: "s", modelSettings: { crewTools: "{nope" } };
    expect(nativeReadOnly(crewNativeInput("claude", broken).modelSettings)).toBe(true);
    expect(() => crewNativeInput("grok", broken)).toThrow(/cannot run read-only/);
  });

  it("the Claude adapter loses its edit and shell tools and the Codex sandbox is read-only", () => {
    const claude = buildClaudeSpawnArgs({ nativeReadOnly: true });
    const at = claude.indexOf("--disallowedTools");
    expect(claude.slice(at + 1)).toEqual(
      expect.arrayContaining(["Bash", "Edit", "Write", "MultiEdit", "NotebookEdit"]),
    );
    expect(buildClaudeSpawnArgs({}).includes("--disallowedTools")).toBe(false);
    const codex = buildThreadStartParams({
      cwd: "/p",
      runtimeMode: "full-access",
      readOnly: true,
    });
    expect(codex).toMatchObject({ approvalPolicy: "never", sandbox: "read-only" });
    expect(buildThreadStartParams({ cwd: "/p", runtimeMode: "full-access" }).sandbox).toBe(
      "danger-full-access",
    );
  });

  it("an already supervised run stays supervised", () => {
    const out = crewNativeInput("claude", {
      ...input({ preset: "read-only" }, "supervised"),
    });
    expect(out.runtimeMode).toBe("supervised");
    expect(out.modelSettings[NATIVE_TOOLS_KEY]).toBe("read-only");
  });
});

describe("MCP servers and skills", () => {
  it("rejects an MCP allowlist on providers that have no hub", () => {
    const tools: CrewToolProfile = { preset: "custom", mcpServers: ["docs"] };
    expect(() => crewNativeInput("cursor", input(tools))).toThrow(/cannot restrict MCP servers/);
    for (const provider of ["claude", "codex", "opencode"])
      expect(crewNativeInput(provider, input(tools)).modelSettings).toBeDefined();
    expect(crewMcpServers(settings(tools))).toEqual(["docs"]);
    expect(crewMcpServers(settings(undefined))).toBeUndefined();
  });

  it("denies every installed skill that is not listed", () => {
    const candidates = [{ name: "a" }, { name: "b" }, { name: "b" }, { name: "c" }];
    expect(crewDeniedSkills(settings({ preset: "custom", skills: ["b"] }), candidates)).toEqual([
      "a",
      "c",
    ]);
    expect(crewDeniedSkills(settings(undefined), candidates)).toEqual([]);
    expect(crewDeniedSkills(settings({ preset: "code" }), candidates)).toEqual([]);
  });
});

describe("withCrewNativeTools", () => {
  it("narrows every operation and rejects instead of throwing synchronously", async () => {
    const send = vi.fn(async () => undefined);
    const steer = vi.fn(async () => undefined);
    const base = { send, steer } as unknown as HostProvider;
    const wrapped = withCrewNativeTools("claude", base);
    await wrapped.send(input({ preset: "read-only" }) as never);
    await wrapped.steer!(input({ preset: "read-only" }) as never);
    for (const fn of [send, steer])
      expect(
        nativeReadOnly(
          (fn.mock.calls as unknown as [{ modelSettings: Record<string, string> }][])[0]![0]
            .modelSettings,
        ),
      ).toBe(true);
    const grok = withCrewNativeTools("grok", base);
    await expect(grok.send(input({ preset: "read-only" }) as never)).rejects.toThrow(
      "Grok cannot run read-only members.",
    );
    expect(send).toHaveBeenCalledTimes(1);
  });
});
