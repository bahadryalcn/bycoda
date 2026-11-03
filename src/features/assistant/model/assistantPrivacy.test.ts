import { expect, it } from "vitest";
import type { AssistantSnapshot } from "../../../shared/model/host-contracts/assistant";
import {
  assistantPrivacyScope,
  projectAssistantSnapshot,
  visibleAssistantMessages,
} from "./assistantPrivacy";
const visible = [{ id: "visible", path: "/visible", name: "Visible" }],
  hidden = { id: "hidden", path: "/hidden", name: "Secret" };
it("keeps verified global quick jobs and their proven global events, trash and messages without project disclosure", () => {
  const raw = source();
  raw.jobs = [
    {
      ...raw.jobs[0],
      id: "quick",
      kind: "quick",
      projectId: null,
      projectIds: [],
      sessionIds: [],
      quickAction: { kind: "note", title: "Owner note", body: "Exact" },
    } as any,
  ];
  raw.activity = [{ id: "event", jobId: "quick", kind: "job.done" } as any];
  raw.trash = [{ id: "jobs:quick", kind: "jobs", projectId: null, projectIds: [] } as any];
  const scope = assistantPrivacyScope([...visible, hidden], [], raw),
    projected = projectAssistantSnapshot(raw, scope)!;
  expect(projected.jobs.map((job) => job.id)).toEqual(["quick"]);
  expect(projected.activity).toHaveLength(1);
  expect(projected.trash).toHaveLength(1);
  expect(
    visibleAssistantMessages(
      [{ id: "message", threadId: "global", jobIds: ["quick"], projectIds: [] }] as any,
      raw,
      scope,
    ),
  ).toHaveLength(1);
  raw.jobs[0] = { ...raw.jobs[0], projectIds: ["hidden"] } as any;
  expect(projectAssistantSnapshot(raw, scope)!.jobs).toEqual([]);
});
function source(): AssistantSnapshot {
  return {
    jobs: [
      { id: "job-visible", projectId: "visible", sessionIds: ["visible-session"] },
      {
        id: "job-hidden",
        projectId: "hidden",
        title: "Secret job",
        sessionIds: ["secret-session"],
      },
    ],
    threads: [
      { id: "global", summary: "Owner global conversation" },
      { id: "visible-thread", projectId: "visible" },
      { id: "hidden-thread", projectId: "hidden", summary: "Secret thread" },
    ],
    activity: [
      { id: "a", kind: "job.started", jobId: "job-visible" },
      { id: "b", kind: "job.started", jobId: "job-hidden", summary: "Secret activity" },
      { id: "c", kind: "job.started", jobId: "not-in-page" },
      { id: "d", kind: "profile.updated" },
      { id: "e", kind: "chief.woke", summary: "Secret totals" },
    ],
    trash: [
      { id: "messages:global", kind: "messages", projectId: null },
      { id: "jobs:v", kind: "jobs", projectId: "visible" },
      { id: "jobs:h", kind: "jobs", projectId: "hidden", title: "Secret trash" },
      { id: "messages:unknown", kind: "messages" },
      { id: "memory:m", kind: "memory" },
      { id: "notes:n", kind: "notetrash" },
    ],
    notes: [{ title: "Global note" }],
    memory: [{ text: "Owner rule" }],
    briefing: { id: "b", text: "Secret briefing", projectIds: ["hidden"] },
    manualGrants: [{ id: "g-hidden", sessionId: "hidden-manual", source: { projectId: "hidden" } }],
  } as unknown as AssistantSnapshot;
}
it("projects only visible work and verified global resources without mutating canonical cache", () => {
  const raw = source(),
    scope = assistantPrivacyScope([...visible, hidden], visible, raw),
    projected = projectAssistantSnapshot(raw, scope)!;
  expect(projected.jobs.map((job) => job.id)).toEqual(["job-visible"]);
  expect(projected.threads.map((thread) => thread.id)).toEqual(["global", "visible-thread"]);
  expect(projected.activity.map((item) => item.id)).toEqual(["a", "d"]);
  expect(projected.trash.map((item) => item.id)).toEqual([
    "messages:global",
    "jobs:v",
    "memory:m",
    "notes:n",
  ]);
  expect(projected.briefing).toBeNull();
  expect(projected.manualGrants).toEqual([]);
  expect(projected.notes).toBe(raw.notes);
  expect(projected.memory).toBe(raw.memory);
  expect(raw.jobs).toHaveLength(2);
  expect(raw.briefing?.text).toBe("Secret briefing");
  expect(JSON.stringify(projected)).not.toContain("Secret");
});
it("keeps global conversations but excludes hidden and unresolved linked message sources from search/cache", () => {
  const raw = source(),
    scope = assistantPrivacyScope([...visible, hidden], visible, raw);
  const messages = [
    { id: "global", threadId: "global", jobIds: [] },
    {
      id: "visible",
      threadId: "visible-thread",
      jobIds: ["job-visible"],
      sessionId: "visible-session",
    },
    { id: "hidden-thread", threadId: "hidden-thread", jobIds: [] },
    { id: "hidden-global", threadId: "global", jobIds: ["job-hidden"] },
    { id: "unknown-session", threadId: "global", jobIds: [], sessionId: "unknown" },
    { id: "unknown-job", threadId: "global", jobIds: ["missing"] },
  ] as any;
  expect(visibleAssistantMessages(messages, raw, scope).map((message) => message.id)).toEqual([
    "global",
    "visible",
  ]);
});
it("removes a newly hidden selection immediately and restores canonical resources on unlock", () => {
  const raw = source(),
    known = [...visible, hidden];
  const unlocked = assistantPrivacyScope(known, known, raw),
    locked = assistantPrivacyScope(known, visible, raw);
  expect(unlocked.unrestricted).toBe(true);
  expect(locked.key).not.toBe(unlocked.key);
  expect(projectAssistantSnapshot(raw, unlocked)?.briefing).toBe(raw.briefing);
  expect(projectAssistantSnapshot(raw, locked)?.jobs.some((job) => job.id === "job-hidden")).toBe(
    false,
  );
  expect(projectAssistantSnapshot(raw, unlocked)?.jobs).toHaveLength(2);
});
it("never treats incomplete discovery or unknown project identities as unrestricted", () => {
  expect(assistantPrivacyScope(null, visible, source()).unrestricted).toBe(false);
  expect(assistantPrivacyScope(visible, visible, source()).unrestricted).toBe(false);
});
it("reads only briefings with trusted visible contributors, including proven global ones", () => {
  const raw = source(),
    scope = assistantPrivacyScope([...visible, hidden], visible, raw);
  raw.briefing!.projectIds = ["visible"];
  expect(projectAssistantSnapshot(raw, scope)?.briefing).toBe(raw.briefing);
  raw.briefing!.projectIds = [];
  expect(projectAssistantSnapshot(raw, scope)?.briefing).toBe(raw.briefing);
  delete raw.briefing!.projectIds;
  expect(projectAssistantSnapshot(raw, scope)?.briefing).toBeNull();
});
it("uses trusted message contributors for native or old sources absent from the loaded snapshot", () => {
  const raw = source(),
    scope = assistantPrivacyScope([...visible, hidden], visible, raw);
  const messages = [
    {
      id: "native-visible",
      threadId: "global",
      sessionId: "native-not-in-page",
      jobIds: [],
      projectIds: ["visible"],
    },
    { id: "old-visible", threadId: "old-thread", jobIds: ["old-job"], projectIds: ["visible"] },
    { id: "mixed", threadId: "global", jobIds: [], projectIds: ["visible", "hidden"] },
  ] as any;
  expect(visibleAssistantMessages(messages, raw, scope).map((message) => message.id)).toEqual([
    "native-visible",
    "old-visible",
  ]);
});
it("hides a whole multi-project job and every linked source if only its lead is visible", () => {
  const raw = source();
  raw.jobs = [{ ...raw.jobs[0], projectIds: ["visible", "hidden"] }];
  raw.manualGrants = [
    { id: "old-grant", sessionId: "visible-session", source: { projectId: "visible" } } as any,
  ];
  raw.activity = [
    { id: "job-event", kind: "job.started", jobId: "job-visible" },
    { id: "session-event", kind: "task.started", sessionId: "visible-session" },
  ] as any;
  raw.trash = [
    {
      id: "jobs:old-multi",
      kind: "jobs",
      projectId: "visible",
      projectIds: ["visible", "hidden"],
    } as any,
  ];
  raw.notifications = [
    {
      id: "notice",
      kind: "job.done",
      jobId: "job-visible",
      projectId: "visible",
      projectIds: ["visible", "hidden"],
    } as any,
  ];
  const scope = assistantPrivacyScope([...visible, hidden], visible, raw),
    result = projectAssistantSnapshot(raw, scope)!;
  expect(result.jobs).toEqual([]);
  expect(result.activity).toEqual([]);
  expect(result.trash).toEqual([]);
  expect(result.notifications).toEqual([]);
  expect(
    visibleAssistantMessages(
      [
        { id: "message", threadId: "global", jobIds: ["job-visible"] },
        { id: "session", threadId: "global", jobIds: [], sessionId: "visible-session" },
      ] as any,
      raw,
      scope,
    ),
  ).toEqual([]);
});
