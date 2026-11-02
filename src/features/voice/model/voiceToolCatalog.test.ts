import { describe, expect, it } from "vitest";
import { voiceToolCatalog } from "../../../../host/voice-tools";
import {
  readVoiceToolCatalog,
  selectVoiceTools,
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
});
