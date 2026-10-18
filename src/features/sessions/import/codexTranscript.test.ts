import { describe, expect, it } from "vitest";
import type { CodexEntry } from "../../../platform/tauri/sessionImport";
import { newSession } from "../model/session";
import {
  buildCodexSession,
  codexToolEvents,
  parseApplyPatch,
  parseShellOutput,
} from "./codexTranscript";

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

  it.each([0, 1, -1])("honors top-level exit_code %s over legacy metadata", (exitCode) => {
    const output = JSON.stringify({
      output: "command result",
      exit_code: exitCode,
      metadata: { exit_code: exitCode === 0 ? 1 : 0 },
      wall_time_seconds: 0.2,
    });
    expect(parseShellOutput(output)).toEqual({
      output: "command result",
      failed: exitCode !== 0,
    });
    expect(
      codexToolEvents({ kind: "tool", at: 1, text: "", name: "exec_command", output }, "shell"),
    ).toEqual([
      expect.objectContaining({
        type: "tool.updated",
        status: exitCode === 0 ? "completed" : "failed",
        detail: "command result",
      }),
    ]);
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

  it("navigates to the move destination and retains the source in the diff", () => {
    const input = [
      "*** Begin Patch",
      "*** Update File: src/old.ts",
      "*** Move to: src/new.ts",
      "@@",
      "-old",
      "+new",
      "*** Add File: src/other.ts",
      "+other",
      "*** End Patch",
    ].join("\r\n");
    expect(parseApplyPatch(input)[0]).toEqual({
      path: "src/new.ts",
      kind: { type: "update" },
      diff: "rename from src/old.ts\nrename to src/new.ts\n@@\n-old\n+new\n",
    });
    const [event] = codexToolEvents(
      { kind: "tool", at: 1, text: "", name: "apply_patch", input, output: "Success" },
      "rename",
    );
    expect(event).toMatchObject({
      type: "tool.updated",
      paths: ["src/new.ts", "src/other.ts"],
      preview: { path: "src/new.ts" },
    });
    expect(JSON.stringify(event)).toContain("rename from src/old.ts");
  });
});

describe("imported patch status", () => {
  const input = "*** Begin Patch\n*** Add File: error.ts\n+error message\n*** End Patch";

  it.each([
    "Success. Updated the following files:\nA error.ts\nM error-handler.ts",
    "Success. Updated the following files:\nA verification failed.ts",
    JSON.stringify({ output: "Success. Updated the following files:\nA error.ts", exit_code: 0 }),
    JSON.stringify({ output: "Success", error: null, isError: false }),
  ])("keeps successful file listings completed: %s", (output) => {
    expect(
      codexToolEvents(
        { kind: "tool", at: 1, text: "", name: "apply_patch", input, output },
        "patch",
      ),
    ).toEqual([expect.objectContaining({ status: "completed" })]);
  });

  it.each([
    "Error: unable to write file",
    "apply_patch verification failed: missing lines",
    "verification failed: missing file",
    "Failed to read file to update missing.ts",
    "apply_patch error: invalid patch",
    JSON.stringify({ error: { message: "invalid patch" } }),
    JSON.stringify({ error: "invalid patch" }),
    JSON.stringify({ isError: true, content: [{ text: "invalid patch" }] }),
    JSON.stringify({ is_error: true }),
    JSON.stringify({ status: "failed" }),
    JSON.stringify({ output: "patch failed", exit_code: 1 }),
    JSON.stringify({ output: "Error: unable to write file", metadata: { exit_code: 0 } }),
  ])("retains actual patch failures: %s", (output) => {
    expect(
      codexToolEvents(
        { kind: "tool", at: 1, text: "", name: "apply_patch", input, output },
        "patch",
      ),
    ).toEqual([expect.objectContaining({ status: "failed" })]);
  });
});

describe("buildCodexSession", () => {
  it("preserves JSON shell failure and rename destination through session construction", () => {
    const session = buildCodexSession({
      base: newSession("codex", "/w"),
      entries: [
        {
          kind: "tool",
          at: 1,
          text: "",
          name: "exec_command",
          input: "pnpm test",
          output: JSON.stringify({
            output: "command failed",
            exit_code: 1,
            wall_time_seconds: 0.2,
          }),
        },
        {
          kind: "tool",
          at: 2,
          text: "",
          name: "apply_patch",
          input:
            "*** Begin Patch\n*** Update File: old.ts\n*** Move to: new.ts\n@@\n-x\n+y\n*** End Patch",
          output: "Success",
        },
      ],
    });
    expect(session.blocks[0].tool).toMatchObject({ kind: "execute", status: "failed" });
    expect(session.blocks[1].tool?.preview).toMatchObject({ path: "new.ts" });
    expect(JSON.stringify(session.blocks[1].tool?.preview?.inspection)).toContain(
      "rename from old.ts",
    );
    expect(JSON.stringify(session.blocks[1].tool?.preview?.inspection)).toContain(
      "rename to new.ts",
    );
  });

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
