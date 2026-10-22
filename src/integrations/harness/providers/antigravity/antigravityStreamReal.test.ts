// Real-binary integration test: drives the stream-json transport against the
// installed agy CLI. Skipped unless AGY_STREAM_REAL=1 and agy exists, because it
// spends Gemini quota. The working directory is a fresh scratch folder.
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { HarnessEvent, SendTurnInput } from "../../core/types";

const BIN = process.env.AGY_BIN ?? join(process.env.LOCALAPPDATA ?? "", "agy", "bin", "agy.exe");
const REAL = process.env.AGY_STREAM_REAL === "1" && existsSync(BIN);

const live = vi.hoisted(() => ({
  children: new Map<string, import("node:child_process").ChildProcess>(),
  lines: new Map<string, (line: string) => void>(),
  exits: new Map<string, (code: number | null) => void>(),
  spawned: [] as { args: string[]; cwd: string }[],
  stdin: [] as string[],
}));

vi.mock("../../core/child", async () => {
  const { spawn } = await import("node:child_process");
  const readline = await import("node:readline");
  return {
    spawnChild: async (key: string, command: string, args: string[], cwd: string) => {
      const child = spawn(command, args, { cwd });
      live.children.set(key, child);
      live.spawned.push({ args, cwd });
      readline
        .createInterface({ input: child.stdout })
        .on("line", (line) => live.lines.get(key)?.(line));
      child.on("exit", (code) => live.exits.get(key)?.(code));
    },
    watchChild: (
      key: string,
      onLine: (line: string) => void,
      onExit: (code: number | null) => void,
    ) => {
      live.lines.set(key, onLine);
      live.exits.set(key, onExit);
    },
    unwatchChild: (key: string) => {
      live.lines.delete(key);
      live.exits.delete(key);
    },
    killChild: async (key: string) => {
      live.children.get(key)?.kill();
      live.children.delete(key);
    },
    writeChild: async (key: string, line: string) => {
      live.stdin.push(line);
      await new Promise<void>((resolve, reject) =>
        live.children
          .get(key)!
          .stdin!.write(line + "\n", (error) => (error ? reject(error) : resolve())),
      );
    },
  };
});

const stream = await import("./antigravityStream");

describe.skipIf(!REAL)("antigravity stream-json transport against real agy", () => {
  it("holds a two-turn conversation and reads a file", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "bycoda-agy-e2e-"));
    writeFileSync(join(cwd, "facts.txt"), "The launch code is 4417.\n");
    const turn = async (text: string) => {
      const events: HarnessEvent[] = [];
      const input: SendTurnInput = {
        sessionId: "e2e",
        cwd,
        model: "antigravity:gemini-3.8-flash-low",
        runtimeMode: "auto-accept-edits",
        text,
        onEvent: (event) => events.push(event),
      };
      await stream.sendAntigravityStreamTurn(input, { path: BIN });
      const reply = events.flatMap((e) => (e.type === "message.delta" ? [e.text] : [])).join("");
      console.log(
        `TURN ${JSON.stringify(text)}\n  -> ${JSON.stringify(reply)}\n  events: ${events.map((e) => e.type + (e.type.startsWith("tool") ? `(${(e as { title?: string }).title ?? ""}|${(e as { status?: string }).status ?? ""})` : "")).join(", ")}`,
      );
      return { events, reply };
    };

    try {
      const first = await turn("Remember the codeword PELICAN. Reply with only the word: noted");
      expect(first.reply.toLowerCase()).toContain("noted");
      const second = await turn(
        "What was the codeword I asked you to remember? Reply with just the word.",
      );
      expect(second.reply).toContain("PELICAN");
      const third = await turn(
        "Read the file facts.txt in the current folder and reply with just the launch code number.",
      );
      expect(third.reply).toContain("4417");
      expect(third.events.some((e) => e.type === "tool.started")).toBe(true);
      // One process served all three turns.
      expect(live.spawned).toHaveLength(1);
      console.log(
        `SPAWN args: ${JSON.stringify(live.spawned[0].args)} cwd: ${live.spawned[0].cwd}`,
      );
      console.log(`STDIN: ${live.stdin.join(" | ")}`);
    } finally {
      await stream.forgetAntigravityStreamSession("e2e");
    }
  }, 300_000);
});
