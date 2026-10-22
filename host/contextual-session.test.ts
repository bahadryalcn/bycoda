import { describe, expect, it } from "vitest";
import type { HostSession, ContextualSessionInput } from "../src/features/connections/model/protocol";
import { previewContextualSession } from "./contextual-session";
function source(): HostSession {
  return { projectId: "project", revision: 4, updatedAt: 1000, createdAt: 100, status: "idle", session: {
    id: "source", cwd: "/project", harness: "codex", model: "codex:test", modelSettings: {}, runtimeMode: "supervised", title: "Search",
    blocks: [{ id: "u", role: "user", text: "Implement search", turnModel: { harness: "codex", id: "codex:test", name: "Codex" } },
      { id: "t", role: "tool", text: "Read source", tool: { callId: "read", kind: "read", status: "completed", output: "Read output" } },
      { id: "a", role: "assistant", text: "Search is implemented." }],
  } };
}
const input: ContextualSessionInput = { sessionId: "source", sourceBlockId: "a", expectedRevision: 4,
  mode: "secondOpinion", harness: "claude", model: "claude:test", modelSettings: {} };
describe("authoritative contextual preview", () => {
  it("bounds the outgoing packet independently of huge historical tool output", () => {
    const value = source();
    value.session.blocks[1]!.tool!.output = "unrelated output ".repeat(100_000);
    const preview = previewContextualSession(value, input);
    expect(preview.contextText.length).toBeLessThan(16_000);
    expect(JSON.stringify(preview).length).toBeLessThan(64_000);
    expect(preview.contextText).toContain("Search is implemented");
    expect(preview.contextText).not.toContain("unrelated output");
    expect(previewContextualSession(value, { ...input, model: "other" }).digest).not.toBe(preview.digest);
    value.session.blocks[2]!.text = "Changed report";
    expect(previewContextualSession(value, input).digest).not.toBe(preview.digest);
  });
  it("rejects excessive turn metadata instead of silently executing a different clipped packet", () => {
    const value = source();
    value.session.blocks.splice(1, 0, ...Array.from({ length: 1001 }, (_, index) => ({ id: `tool-${index}`, role: "tool" as const, text: "Tool" })));
    expect(() => previewContextualSession(value, input)).toThrow(/review limit/);
    const path = source();
    path.session.blocks[1]!.tool = { callId: "edit", kind: "edit", status: "completed", preview: { path: "x".repeat(4097) } };
    expect(() => previewContextualSession(path, input)).toThrow(/review limit/);
    const request = source();
    request.session.blocks[0]!.text = "x".repeat(16_001);
    expect(() => previewContextualSession(request, input)).toThrow(/review limit/);
  });
  it("uses only the selected completed turn and never leaks a later reply into its review", () => {
    const value = source();
    value.session.blocks.push({ id: "u2", role: "user", text: "Later private request" }, { id: "a2", role: "assistant", text: "Later private answer" });
    for (const mode of ["secondOpinion", "handoff"] as const) {
      const preview = previewContextualSession(value, { ...input, mode });
      expect(preview.contextText).toContain("Search is implemented");
      expect(preview.contextText).not.toContain("Later private");
      expect(preview.turnBlockIds).toEqual(["u", "t", "a"]);
      expect(preview.sourceProvider).toBe("codex");
    }
    expect(() => previewContextualSession({ ...value, status: "running" }, input)).toThrow(/finish/);
    expect(() => previewContextualSession(value, { ...input, sourceBlockId: "t" })).toThrow(/completed reply/);
  });
  it("permits a proven first-adoption revision mapping without weakening source content binding", () => {
    const value = source();
    const preview = previewContextualSession(value, input);
    const adopted = { ...value, revision: 1, desktop: { revision: 4, updatedAt: 1000 } };
    expect(() => previewContextualSession(adopted, input)).toThrow(/source conversation changed/);
    expect(previewContextualSession(adopted, input, true).digest).toBe(preview.digest);
    expect(() => previewContextualSession({ ...adopted, updatedAt: 1001 }, input, true)).toThrow(/source conversation changed/);
    const changed = { ...adopted, session: { ...adopted.session, title: "Different source title" } };
    expect(previewContextualSession(changed, input, true).digest).not.toBe(preview.digest);
  });
});
