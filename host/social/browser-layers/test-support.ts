import { Window } from "happy-dom";
import { vi } from "vitest";
import type {
  DecisionRequest,
  DecisionResult,
  DecisionService,
} from "../../decision-models/decision-types";
import type { BrowserPage } from "../social-browser";
import type { SettingsStore } from "./record-index";

/** In-memory settings rows with the same get/put contract as the audience store. */
export function memorySettings(): SettingsStore & { rows: Map<string, string> } {
  const rows = new Map<string, string>();
  return {
    rows,
    getSetting: async (key: string) => rows.get(key),
    putSetting: async (key: string, value: string) => {
      rows.set(key, value);
    },
  };
}

/**
 * A DOM-backed page. Interaction methods are spies; read-only probes run through happy-dom's eval.
 * Detection and summaries must never call the interaction spies.
 */
export function domPage(url: string, html: string) {
  const window = new Window({ url });
  window.document.body.innerHTML = html;
  Object.defineProperty(window.HTMLElement.prototype, "getClientRects", {
    configurable: true,
    value() {
      return [{ width: 100, height: 30 }];
    },
  });
  const interactions = {
    goto: vi.fn(),
    click: vi.fn(async (_selector: string) => undefined),
    fill: vi.fn(),
    insertText: vi.fn(),
    setFiles: vi.fn(),
    cookies: vi.fn(),
    watchResponse: vi.fn(),
  };
  const page = {
    ...interactions,
    evaluate: vi.fn(async <T>(expression: string): Promise<T> => window.eval(expression) as T),
    screenshot: vi.fn(async () => new Uint8Array([1, 2, 3])),
  };
  return { page: page as unknown as BrowserPage, window, interactions };
}

type Answer = { value: string; confidence: number } | "unavailable";

function answerFor(answer: Answer) {
  return answer === "unavailable"
    ? { error: "unavailable" as const }
    : { value: answer.value, confidence: answer.confidence, sourceId: "fake", model: "fake" };
}

/** Decision service whose answers depend on the task type. Every request is recorded. */
export function fakeDecisions(answers: { screen?: Answer; element?: Answer }) {
  const calls: DecisionRequest[] = [];
  const service: DecisionService & { calls: DecisionRequest[] } = {
    calls,
    async decide(request: DecisionRequest): Promise<DecisionResult> {
      calls.push(request);
      const answer = request.taskType === "element_choice" ? answers.element : answers.screen;
      const key = Object.keys(request.questions)[0]!;
      return {
        answers: { [key]: answerFor(answer ?? "unavailable") },
        sourceChain: ["fake"],
        durationMs: 1,
      } as DecisionResult;
    },
  };
  return service;
}

/** A session whose `closed` promise the test resolves to simulate a crash or a close. */
export function fakeSession() {
  let close!: () => void;
  const closed = new Promise<void>((resolve) => {
    close = resolve;
  });
  return {
    closed,
    crash: () => close(),
    session: {
      page: {} as BrowserPage,
      closed,
      close: vi.fn(async () => {
        close();
      }),
    },
  };
}
