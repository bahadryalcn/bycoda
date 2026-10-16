import { describe, expect, it } from "vitest";
import {
  clearComposerDraft,
  getComposerDraft,
  getComposerMcpTags,
  setComposerDraft,
  setComposerMcpTags,
} from "./draftCache";
import { newMcpTag } from "./mcpPicker";

describe("draftCache", () => {
  it("returns undefined for a session that never had a draft", () => {
    expect(getComposerDraft("never-seen")).toBeUndefined();
  });

  it("gives back the last text set for a session, across separate reads", () => {
    // This is the actual bug: SessionPane used to keep the composer's text
    // in a component-local ref, so closing a session's pane (unmounting
    // SessionPane) and reopening it - a fresh component instance calling
    // getComposerDraft again - lost whatever was typed. A module-level
    // cache has to answer the same text back on a later, independent read.
    setComposerDraft("s1", "half-typed message");

    expect(getComposerDraft("s1")).toBe("half-typed message");
  });

  it("keeps drafts for different sessions apart", () => {
    setComposerDraft("s2", "draft for session two");
    setComposerDraft("s3", "draft for session three");

    expect(getComposerDraft("s2")).toBe("draft for session two");
    expect(getComposerDraft("s3")).toBe("draft for session three");
  });

  it("treats setting an empty string as clearing the draft", () => {
    setComposerDraft("s4", "something");
    setComposerDraft("s4", "");

    expect(getComposerDraft("s4")).toBeUndefined();
  });

  it("clearComposerDraft removes a stored draft", () => {
    setComposerDraft("s5", "will be cleared");
    clearComposerDraft("s5");

    expect(getComposerDraft("s5")).toBeUndefined();
  });

  it("keeps MCP tag metadata with its session draft", () => {
    const tag = newMcpTag(
      {
        provider: "codex",
        name: "docs",
        scope: "user",
        configPath: "/config.toml",
        transport: "stdio",
      },
      [],
    );
    setComposerDraft("mcp-one", `Ask ${tag.token}`);
    setComposerMcpTags("mcp-one", [tag]);
    setComposerDraft("mcp-two", "Another draft");
    expect(getComposerMcpTags("mcp-one")).toEqual([tag]);
    expect(getComposerMcpTags("mcp-two")).toEqual([]);
    setComposerDraft("mcp-one", "");
    expect(getComposerMcpTags("mcp-one")).toEqual([]);
  });
});

describe("draftCache persistence hooks", () => {
  it("restores a saved draft but never over text typed in this run", async () => {
    const { clearComposerDraft, restoreComposerDraft, getComposerDraft } =
      await import("./draftCache");
    clearComposerDraft("r1");
    expect(restoreComposerDraft("r1", { text: "saved", mcpTags: [], attachments: [] })).toBe(true);
    expect(getComposerDraft("r1")).toBe("saved");

    setComposerDraft("r2", "typed now");
    expect(restoreComposerDraft("r2", { text: "saved", mcpTags: [], attachments: [] })).toBe(false);
    expect(getComposerDraft("r2")).toBe("typed now");
  });

  it("tells subscribers which session changed, and not for no-ops", async () => {
    const { subscribeComposerDrafts } = await import("./draftCache");
    const seen: string[] = [];
    const stop = subscribeComposerDrafts((id) => seen.push(id));
    setComposerDraft("n1", "a");
    setComposerDraft("n1", "a");
    setComposerDraft("n1", "");
    setComposerDraft("n1", "");
    stop();
    setComposerDraft("n1", "b");
    expect(seen).toEqual(["n1", "n1"]);
  });

  it("hands a restore notice out once", async () => {
    const { restoreComposerDraft, takeComposerNotice, clearComposerDraft } =
      await import("./draftCache");
    clearComposerDraft("m1");
    restoreComposerDraft("m1", { text: "x", mcpTags: [], attachments: [], notice: "lost one" });
    expect(takeComposerNotice("m1")).toBe("lost one");
    expect(takeComposerNotice("m1")).toBeUndefined();
  });
});
