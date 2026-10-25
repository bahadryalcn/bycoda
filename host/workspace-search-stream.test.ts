import { beforeEach, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
const api = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", async (original) => ({
  ...(await original<typeof import("node:child_process")>()),
  spawn: api.spawn,
}));
vi.mock("./git-start-gate", () => ({ hostGitStarts: { enter: async () => {} } }));
import { searchHostContent } from "./workspace";

let child: EventEmitter & {
  stdout: PassThrough;
  stderr: PassThrough;
  kill: ReturnType<typeof vi.fn>;
};
beforeEach(() => {
  child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(() => true),
  });
  api.spawn.mockReset().mockReturnValue(child);
});
const started = () => vi.waitFor(() => expect(api.spawn).toHaveBeenCalledOnce());

it("ends grep after a complete result page instead of waiting for a full scan", async () => {
  const pending = searchHostContent("C:/repo", { query: "needle" });
  await started();
  child.stdout.write(
    Buffer.from(
      Array.from({ length: 600 }, (_, i) => `file.txt\0${i + 1}\0${1}\0needle\n`).join(""),
    ),
  );
  const result = await pending;
  expect(result.truncated).toBe(true);
  expect(result.matches).toHaveLength(500);
  expect(result.matches[499].line).toBe(500);
  expect(child.kill).toHaveBeenCalledOnce();
  expect(child.stdout.destroyed).toBe(true);
});

it("aborts the running child and releases its output streams", async () => {
  const controller = new AbortController();
  const pending = searchHostContent("C:/repo", { query: "needle" }, controller.signal).catch(
    (error) => error,
  );
  await started();
  controller.abort(new Error("cancelled"));
  expect(await pending).toMatchObject({ message: "cancelled" });
  expect(child.kill).toHaveBeenCalledOnce();
  expect(child.stdout.destroyed).toBe(true);
  expect(child.stderr.destroyed).toBe(true);
});

it("counts accepted whole-word results rather than raw substring candidates", async () => {
  const pending = searchHostContent("C:/repo", { query: "needle", wholeWord: true });
  await started();
  const falseMatches = Array.from(
    { length: 600 },
    (_, i) => `file.txt\0${i + 1}\0${1}\0needles\n`,
  ).join("");
  child.stdout.write(Buffer.from(falseMatches));
  expect(child.kill).not.toHaveBeenCalled();
  child.stdout.write(Buffer.from(`file.txt\0${601}\0${1}\0needle\n`));
  child.emit("close", 0);
  expect(await pending).toMatchObject({
    truncated: false,
    matches: [{ line: 601, preview: "needle" }],
  });
});

it("keeps UTF-8 matches complete across arbitrary process chunks", async () => {
  const pending = searchHostContent("C:/repo", { query: "ö" });
  await started();
  for (const byte of Buffer.from(`file.txt\0${1}\0${3}\0şö needle\n`))
    child.stdout.write(Buffer.from([byte]));
  child.emit("close", 0);
  expect(await pending).toMatchObject({
    truncated: false,
    matches: [{ preview: "şö needle", column: 2 }],
  });
});
