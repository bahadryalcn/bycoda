// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { AssistantOwnerQuestions } from "./AssistantOwnerQuestions";
import {
  AssistantRequestValidationSchema,
  AssistantResponseValidationSchema,
  type AssistantRequest,
  type AssistantResponse,
} from "../../../shared/model/host-contracts/assistant";
import {
  AssistantOwnerQuestionSchema,
  type AssistantOwnerQuestionReceipt,
} from "../../../shared/model/assistantOwnerQuestions";
import {
  pendingOwnerQuestions,
  ownerQuestionDraftScope,
  ownerQuestionPrompt,
} from "../model/assistantOwnerQuestions";
import { resolveQuestionDraft } from "../../sessions/model/questionDrafts";
let next = 0;
const cleanups: Array<() => void> = [];
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await act(async () => close());
  localStorage.clear();
  vi.unstubAllGlobals();
});
async function fixture() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const question = AssistantOwnerQuestionSchema.parse({
    id: `host-question-${++next}`,
    version: 1,
    jobId: "job",
    projectIds: ["p"],
    sourceToken: "a".repeat(64),
    sourceCurrent: true,
    origin: "chief",
    status: "open",
    createdAt: 1,
    updatedAt: 1,
    prompt: {
      requestId: 7,
      occurrenceId: `host-occurrence-${next}`,
      title: "Scope choice",
      behavior: "nonBlocking",
      questions: [
        {
          id: "canonical-question-id",
          prompt: "Choose the result",
          multiSelect: false,
          allowCustom: true,
          options: [
            { id: "canonical-small", label: "Focused change" },
            { id: "canonical-other", label: "Other" },
          ],
        },
      ],
    },
  });
  let current = structuredClone(question),
    root: Root,
    dropAck = false;
  const receipts = new Map<string, AssistantOwnerQuestionReceipt>(),
    calls: Array<{ input: AssistantRequest; environmentId?: string }> = [];
  const request = vi.fn(
    async (raw: AssistantRequest, environmentId?: string): Promise<AssistantResponse> => {
      const input = AssistantRequestValidationSchema.parse(raw);
      calls.push({ input, environmentId });
      expect(environmentId).toBe("host-original");
      if (input.op === "questions.get")
        return AssistantResponseValidationSchema.parse({
          ownerQuestion: current,
          ...(input.requestId && receipts.has(input.requestId)
            ? { ownerQuestionReceipt: receipts.get(input.requestId) }
            : {}),
        });
      if (input.op !== "questions.answer" && input.op !== "questions.snooze")
        throw new Error("Unexpected owner operation");
      expect(pendingOwnerQuestions(localStorage, "host-original")).toHaveLength(1);
      const receipt: AssistantOwnerQuestionReceipt = {
        requestId: input.requestId,
        kind: input.op === "questions.answer" ? "answer" : "snooze",
        version: current.version + 1,
        at: Date.now(),
        input,
      };
      receipts.set(input.requestId, receipt);
      current = {
        ...current,
        version: receipt.version,
        lastOwnerAction: receipt,
        ...(input.op === "questions.answer"
          ? {
              status: "answered",
              answer: {
                requestId: input.requestId,
                answers: input.answers,
                custom: input.custom,
                answeredAt: receipt.at,
                version: receipt.version,
              },
            }
          : { status: "snoozed", snoozedUntil: input.until }),
      };
      if (dropAck) throw new Error("Lost acknowledgement");
      return AssistantResponseValidationSchema.parse({
        ownerQuestion: current,
        ownerQuestionReceipt: receipt,
      });
    },
  );
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  let visible = ["p"],
    environmentId = "host-original",
    questions = [question];
  const render = async () => {
    await act(async () =>
      root.render(
        createElement(AssistantOwnerQuestions, {
          questions,
          environmentId,
          visibleProjectIds: visible,
          request,
        }),
      ),
    );
  };
  await render();
  cleanups.push(() => {
    root.unmount();
    container.remove();
    resolveQuestionDraft(
      ownerQuestionDraftScope("host-original", question),
      ownerQuestionPrompt(question, "Type your answer"),
    );
  });
  const button = (text: string) =>
    [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === text,
    )!;
  const select = async () => {
    await act(async () =>
      container.querySelector<HTMLInputElement>('input[type="radio"]')!.click(),
    );
  };
  const submit = async () => {
    await act(async () =>
      container
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
  };
  return {
    question,
    container,
    request,
    calls,
    button,
    select,
    submit,
    render,
    get current() {
      return current;
    },
    set dropAck(value: boolean) {
      dropAck = value;
    },
    hide: async () => {
      visible = [];
      await render();
    },
    show: async () => {
      visible = ["p"];
      await render();
    },
    switchHost: async () => {
      environmentId = "other-host";
      await render();
    },
    remount: async () => {
      await act(async () => root.unmount());
      root = createRoot(container);
      await render();
    },
    publish: async () => {
      questions = [current];
      await render();
    },
  };
}
it("shows a canonical card without requests, uses literal Host options and sends only after an actual owner action", async () => {
  const f = await fixture();
  expect(f.calls).toEqual([]);
  expect(f.container.textContent).toContain("Choose the result");
  expect(f.button("Later")).toBeTruthy();
  const radios = [...f.container.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
  expect(radios).toHaveLength(3);
  expect(f.container.querySelector("textarea")).toBeNull();
  await f.select();
  await f.submit();
  expect(f.calls.map((call) => call.input.op)).toEqual(["questions.get", "questions.answer"]);
  expect(f.calls[1].input).toMatchObject({
    id: f.question.id,
    expectedVersion: 1,
    answers: { "canonical-question-id": ["canonical-small"] },
  });
  expect(f.container.textContent).not.toContain("Choose the result");
});
it("maps Later to a snooze and leaves the question available to answer later", async () => {
  const f = await fixture();
  await act(async () => f.button("Later").click());
  expect(f.calls[1].input.op).toBe("questions.snooze");
  expect(f.calls.some((call) => call.input.op === "questions.answer")).toBe(false);
  await f.publish();
  expect(f.container.textContent).toContain("Snoozed until");
  expect(f.button("Answer now")).toBeTruthy();
});
it("keeps an unknown acknowledgement through unmount and verifies it without resending the answer", async () => {
  const f = await fixture();
  f.dropAck = true;
  await f.select();
  await f.submit();
  expect(f.container.textContent).toContain("unconfirmed");
  expect(f.button("Retry")).toBeTruthy();
  await f.remount();
  expect(f.container.textContent).toContain("unconfirmed");
  await act(async () => f.button("Retry").click());
  expect(f.calls.filter((call) => call.input.op === "questions.answer")).toHaveLength(1);
  expect(pendingOwnerQuestions(localStorage, "host-original")).toEqual([]);
});
it("conceals a pending contributor when privacy changes during a deferred source read and does not write on return", async () => {
  const f = await fixture();
  let release!: (value: AssistantResponse) => void;
  f.request.mockImplementationOnce(
    () =>
      new Promise((done) => {
        release = done;
      }),
  );
  await f.select();
  await f.submit();
  await f.hide();
  expect(f.container.textContent).not.toContain("Scope choice");
  expect(f.container.querySelector("article")).toBeNull();
  await act(async () => release({ ownerQuestion: f.current }));
  expect(f.calls.some((call) => call.input.op === "questions.answer")).toBe(false);
  await f.show();
  expect(f.button("Retry")).toBeTruthy();
  expect(f.calls.some((call) => call.input.op === "questions.answer")).toBe(false);
});
it("does not retarget an accepted answer when the selected Host changes before source verification returns", async () => {
  const f = await fixture();
  let release!: (value: AssistantResponse) => void;
  f.request.mockImplementationOnce(
    () =>
      new Promise((done) => {
        release = done;
      }),
  );
  await f.select();
  await f.submit();
  await f.switchHost();
  await act(async () => release({ ownerQuestion: f.current }));
  expect(f.calls.some((call) => call.input.op === "questions.answer")).toBe(false);
  expect(pendingOwnerQuestions(localStorage, "host-original")).toHaveLength(1);
  expect(pendingOwnerQuestions(localStorage, "other-host")).toEqual([]);
});
