import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const launch = vi.fn();
const state = vi.fn();
vi.mock("../sessions/sessionRuns", () => ({
  launchSessionRun: (...args: unknown[]) => launch(...args),
  sessionRunState: (...args: unknown[]) => state(...args),
}));
const { antigravityImageBrief, generateAntigravityImage } = await import("./antigravity-images");

const roots: string[] = [];
afterEach(() => {
  launch.mockReset();
  state.mockReset();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function input() {
  const root = mkdtempSync(join(tmpdir(), "agy-images-"));
  roots.push(root);
  let clock = 0;
  return {
    root,
    value: {
      store: {} as never,
      engine: {} as never,
      projectId: "project",
      parent: { id: "parent", runtimeMode: "supervised" as const },
      model: "agy-model",
      prompt: 'Logo "quoted"',
      aspectRatio: "1:1",
      target: join(root, "logo.png"),
      now: () => (clock += 1000),
      sleep: async () => {},
    },
  };
}

it("quotes the description and names the exact target path", () => {
  const brief = antigravityImageBrief('Logo "x"', "16:9", "C:\\p\\logo.png");
  expect(brief).toContain("generate_image");
  expect(brief).toContain(JSON.stringify('Logo "x"'));
  expect(brief).toContain(JSON.stringify("C:\\p\\logo.png"));
});

it("starts a child Antigravity session and returns the saved file", async () => {
  const { value } = input();
  launch.mockResolvedValue({ sessionId: "child", runId: "run" });
  state
    .mockResolvedValueOnce({ state: "running", needsInput: false })
    .mockImplementationOnce(async () => {
      writeFileSync(value.target, "image-bytes");
      return { state: "finished", status: "succeeded" };
    });
  const result = await generateAntigravityImage(value);
  expect(result).toMatchObject({ model: "agy-model", sessionId: "child" });
  expect(result.bytes.toString()).toBe("image-bytes");
  const spec = launch.mock.calls[0]![2];
  expect(spec).toMatchObject({
    harness: "antigravity",
    model: "agy-model",
    runtimeMode: "supervised",
  });
  expect(JSON.parse(spec.modelSettings.delegationParent)).toMatchObject({
    parentSessionId: "parent",
  });
});

it("reports approval waits, failures and missing files without claiming success", async () => {
  const { value } = input();
  launch.mockResolvedValue({ sessionId: "child", runId: "run" });
  state.mockResolvedValueOnce({ state: "running", needsInput: true });
  await expect(generateAntigravityImage(value)).rejects.toThrow("waiting for approval");
  state.mockResolvedValueOnce({ state: "finished", status: "failed", error: "quota" });
  await expect(generateAntigravityImage(value)).rejects.toThrow("failed: quota");
  state.mockResolvedValueOnce({ state: "finished", status: "succeeded" });
  await expect(generateAntigravityImage(value)).rejects.toThrow("without saving");
  launch.mockResolvedValueOnce({ error: "agy missing" });
  await expect(generateAntigravityImage(value)).rejects.toThrow("agy missing");
});
