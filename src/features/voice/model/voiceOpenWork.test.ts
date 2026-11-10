import { expect, it } from "vitest";
import type { AssistantSnapshot } from "../../../shared/model/host-contracts/assistant";
import {
  VOICE_OPEN_WORK_MAX_CHARS,
  VOICE_OPEN_WORK_MAX_JOBS,
  formatVoiceOpenWork,
  voiceSeedItems,
} from "./voiceOpenWork";

type Source = Pick<AssistantSnapshot, "jobs" | "jobHolds" | "ownerQuestions">;
const visibleP1 = (item: Source["jobs"][number]) => item.projectId === "p1";
const job = (id: string, status: string, projectId = "p1", title = `Job ${id}`) =>
  ({ id, title, status, projectId, version: 1 }) as Source["jobs"][number];
const question = (id: string, projectIds: string[], status = "open") =>
  ({ id, projectIds, status }) as NonNullable<Source["ownerQuestions"]>[number];

it("lists non-terminal visible jobs with status, hold reason and question count", () => {
  const text = formatVoiceOpenWork(
    {
      jobs: [
        job("a", "running"),
        job("b", "done"),
        job("c", "waiting", "hidden", "Secret"),
        job("d", "queued"),
      ],
      jobHolds: { d: "limits" },
      ownerQuestions: [
        question("q1", ["p1"]),
        question("q2", ["hidden"]),
        question("q3", ["p1"], "answered"),
      ],
    },
    new Set(["p1"]),
    visibleP1,
  );
  expect(text).toContain("data only");
  expect(text).toContain("- Job a (running)");
  expect(text).toContain("- Job d (queued, held: limits)");
  expect(text).toContain("Pending owner questions: 1");
  expect(text).not.toMatch(/Job b|Secret/);
});

it("is empty without open work and bounded for many long jobs", () => {
  expect(formatVoiceOpenWork({ jobs: [job("a", "done")] }, new Set(["p1"]), visibleP1)).toBe("");
  const jobs = Array.from({ length: 40 }, (_, i) => job(`j${i}`, "running", "p1", "x".repeat(500)));
  const text = formatVoiceOpenWork({ jobs }, new Set(["p1"]), visibleP1);
  expect(text.length).toBeLessThanOrEqual(VOICE_OPEN_WORK_MAX_CHARS);
  expect(text.split("\n").length - 1).toBeLessThanOrEqual(VOICE_OPEN_WORK_MAX_JOBS);
});

it("seeds text messages only: summary, open work, then recent turns", () => {
  const items = voiceSeedItems("sum", "Open work", [{ role: "user", text: "hi" }]);
  expect(items).toHaveLength(3);
  expect(items.every((item) => item.type === "conversation.item.create")).toBe(true);
  expect(JSON.stringify(items)).not.toMatch(/tool|function/);
  expect(voiceSeedItems(undefined, "", [])).toEqual([]);
});

it("reads open work through the same scope filter as assistant_status", async () => {
  const { VoiceAssistantControls } = await import("./voiceAssistantControls");
  const snapshot = {
    jobs: [job("a", "running"), job("c", "waiting", "hidden", "Secret")],
  } as unknown as AssistantSnapshot;
  const controls = new VoiceAssistantControls({
    request: async () => ({ snapshot }),
    allowedProjectIds: async () => new Set(["p1"]),
    confirm: async () => false,
  });
  const text = await controls.openWork(() => true);
  expect(text).toContain("Job a");
  expect(text).not.toContain("Secret");
  expect(await controls.openWork(() => false)).toBe("");
});
