import { act } from "react";
import { expect } from "vitest";
import type { AssistantSnapshot } from "../../../shared/model/host-contracts/assistant";

/** Saved Room snapshot fixture shared by the AssistantView suites. */
export function snapshot(): AssistantSnapshot {
  return {
    profile: {
      name: "Arif",
      showTitle: true,
      avatar: "",
      addressAs: "",
      addressFrequency: "sometimes",
      tone: "friendly",
      allowProfanity: false,
      persona: "",
      confirmJobs: true,
      language: "auto",
      autonomy: "report",
      planApproval: "large",
      dailyTokenBudget: 200000,
      perWakeTokenCap: 8000,
      enabled: true,
      setupComplete: true,
      voiceSetupComplete: false,
      proactiveSpeech: "never",
      keepAwakeWhileWorking: false,
      quietStart: 22,
      quietEnd: 8,
      chiefSoftContext: 150000,
      chiefHardContext: 250000,
      workerSoftContext: 150000,
      workerHardContext: 300000,
      workerCompactPercent: 50,
      workerHandoffPercent: 80,
      stallMinutes: 15,
      execution: null,
      chiefExecution: null,
      replyExecution: null,
      planningExecution: null,
      allowRoutineQuestions: false,
      version: 3,
      updatedAt: 1,
    },
    jobs: [],
    memory: [],
    threads: [],
    activity: [],
    notes: [],
    trash: [],
    presence: { state: "present", since: 1, updatedAt: 1 },
    usage: {
      day: "2026-11-02",
      chiefTokens: 0,
      workerTokens: 0,
      total: 0,
      mode: "report",
      estimated: false,
    },
    paused: false,
    lastHeartbeatAt: null,
    briefing: null,
    capabilities: {
      jobs: true,
      chief: false,
      notes: true,
      conversations: true,
    },
  };
}
/** A running project job with one task and one session. */
export function job(id = "job-one") {
  return {
    id,
    version: 7,
    title: "Fix login",
    request: "Fix login",
    projectId: "project-one",
    status: "running" as const,
    goalId: "goal-one",
    taskIds: ["task-one"],
    sessionIds: ["session-one"],
    progress: { done: 1, total: 3 },
    createdAt: 1,
    updatedAt: 2,
    summary: "Running tests",
    tokens: 1200,
    idempotencyKey: "request-one",
    dispatchState: "submitted" as const,
  };
}
/** Clicks the first button whose aria-label or text matches. */
export async function click(label: string) {
  // Follow the Room's grouped navigation before looking for its destination.
  const group = ["Notes", "Memory", "History"].includes(label)
    ? "Records"
    : ["Jobs", "Sessions"].includes(label)
      ? "Work"
      : null;
  if (
    group &&
    ![...document.querySelectorAll('[role="tab"]')].some((tab) => tab.textContent?.trim() === label)
  ) {
    const parent = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
      (tab) => tab.getAttribute("aria-label") === group || tab.textContent?.trim() === group,
    );
    if (parent) await act(async () => parent.click());
  }
  const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (element) =>
      element.getAttribute("aria-label") === label || element.textContent?.trim() === label,
  );
  expect(button, label).toBeDefined();
  await act(async () => button!.click());
}
export function setTextareaValue(textarea: HTMLTextAreaElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
    textarea,
    value,
  );
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}
export async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
/** Grants the same per-origin send lock as supported browsers. */
export function stubNavigatorLocks() {
  let sendLocked = false;
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: {
      request: async (
        _name: string,
        _options: unknown,
        callback: (lock: object | null) => Promise<unknown>,
      ) => {
        if (sendLocked) return callback(null);
        sendLocked = true;
        try {
          return await callback({ name: _name });
        } finally {
          sendLocked = false;
        }
      },
    },
  });
}
