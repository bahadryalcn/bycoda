import { describe, expect, it } from "vitest";
import type { CodexEntry } from "../../../platform/tauri/sessionImport";
import { newSession } from "../model/session";
import { buildCodexSession, parseApplyPatch, parseShellOutput } from "./codexTranscript";

describe("parseShellOutput", () => {
  it("unwraps the exit-code header and reports failures", () => {
    expect(parseShellOutput("Exit code: 0\nWall time: 1.2 seconds\nOutput:\nok\n")).toEqual({
      output: "ok\n",
      failed: false,
    });
    expect(parseShellOutput("Exit code: 2\nWall time: 0 seconds\nOutput:\nboom").failed).toBe(true);
  });

  it("reads the JSON form and leaves anything else alone", () => {
    expect(parseShellOutput('{"output":"hi","metadata":{"exit_code":1}}')).toEqual({
      output: "hi",
      failed: true,
    });
    expect(parseShellOutput("just text")).toEqual({ output: "just text", failed: false });
    expect(parseShellOutput(undefined)).toEqual({ output: "", failed: false });
  });
});

describe("parseApplyPatch", () => {
  it("splits an envelope into one change per file", () => {
    const changes = parseApplyPatch(
      [
        "*** Begin Patch",
        "*** Update File: src/a.ts",
        "@@",
        "-old",
        "+new",
        "*** Add File: src/b.ts",
        "+hello",
        "*** Delete File: src/c.ts",
        "*** End Patch",
      ].join("\n"),
    );
    expect(changes.map((c) => [c.path, c.kind.type])).toEqual([
      ["src/a.ts", "update"],
      ["src/b.ts", "add"],
      ["src/c.ts", "delete"],
    ]);
    expect(changes[0].diff).toBe("@@\n-old\n+new\n");
    expect(changes[1].diff).toBe("+hello\n");
  });
});

describe("buildCodexSession", () => {
  const entries: CodexEntry[] = [
    { kind: "user", at: 1_700_000_000_000, text: "run the tests" },
    {
      kind: "tool",
      at: 1,
      text: "",
      callId: "c1",
      name: "shell_command",
      input: "npm test",
      output: "Exit code: 1\nWall time: 1 seconds\nOutput:\n1 failing",
      cwd: "/w",
    },
    {
      kind: "tool",
      at: 2,
      text: "",
      callId: "c2",
      name: "apply_patch",
      input: "*** Begin Patch\n*** Update File: a.ts\n@@\n-x\n+y\n*** End Patch",
      output: "Success",
    },
    { kind: "tool", at: 3, text: "", callId: "c3", name: "view_image", input: "{}" },
    { kind: "assistant", at: 4, text: "One test fails." },
  ];

  it("renders messages and tool calls as ordinary blocks", () => {
    const session = buildCodexSession({
      base: newSession("codex", "/w"),
      entries,
    });
    expect(session.blocks.map((b) => b.role)).toEqual([
      "user",
      "tool",
      "tool",
      "tool",
      "assistant",
    ]);
    expect(session.blocks[0]).toMatchObject({
      text: "run the tests",
      startedAt: 1_700_000_000_000,
    });
    expect(session.blocks[1].tool).toMatchObject({ kind: "execute", status: "failed" });
    expect(session.blocks[1].text).toContain("npm test");
    expect(session.blocks[2].tool?.kind).toBe("edit");
    expect(session.blocks[3].text).toBe("View image");
    expect(session.blocks[4].text).toBe("One test fails.");
    expect(session.blocks.some((b) => b.streaming)).toBe(false);
  });
});
