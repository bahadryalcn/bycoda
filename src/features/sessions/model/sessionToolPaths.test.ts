import { expect, it } from "vitest";
import type { Block } from "./session";
import { sessionToolFilePaths } from "./sessionToolPaths";

const tool = (id: string, extra: Block["tool"]): Block => ({
  id,
  role: "tool",
  text: "",
  tool: { status: "completed", ...extra },
});

it("includes subagent steps and marks listed folders", () => {
  const listed: Block = { ...tool("list", { title: "List" }), text: "List G:/Projects/bykit/src" };
  const agent: Block = {
    ...tool("agent", { title: "Agent" }),
    agentRun: {
      name: "Outline",
      steps: [
        {
          id: "s1",
          kind: "tool",
          text: "Edit",
          status: "completed",
          preview: { kind: "write", path: "G:/Projects/bykit/src/read.rs" },
        },
      ],
    },
  };
  expect(sessionToolFilePaths([listed, agent], "G:/Projects/monocode")).toEqual([
    "G:/Projects/bykit/src/read.rs",
    "G:/Projects/bykit/src/",
  ]);
});

it("lists files the tools touched, newest first and once each", () => {
  const blocks: Block[] = [
    { id: "u", role: "user", text: "work on bykit" },
    tool("write", { preview: { kind: "write", path: "G:/Projects/bykit/src/port.rs" } }),
    tool("changes", {
      fileChanges: [{ path: "G:/Projects/bykit/src/page.rs" }, { path: "src/local.ts" }],
    }),
    tool("again", { preview: { kind: "write", path: "G:/Projects/bykit/src/port.rs" } }),
    { id: "a", role: "assistant", text: "Now `read.rs`." },
  ];
  expect(sessionToolFilePaths(blocks, "G:/Projects/monocode")).toEqual([
    "G:/Projects/bykit/src/port.rs",
    "G:/Projects/bykit/src/page.rs",
    "G:/Projects/monocode/src/local.ts",
  ]);
});
