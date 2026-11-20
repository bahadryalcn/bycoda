// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { AssistantOwnerQuestions } from "./AssistantOwnerQuestions";
import {
  pendingOwnerQuestionPresentations,
  saveOwnerQuestionPresentation,
} from "../model/assistantOwnerQuestionPresentations";

const cleanups: Array<() => void> = [];
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await act(async () => close());
  localStorage.clear();
  vi.unstubAllGlobals();
});

it("reports a failed retry distinctly while keeping the unanswered presentation for another safe retry", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  saveOwnerQuestionPresentation(localStorage, {
    format: 1,
    environmentId: "host",
    input: {
      op: "questions.present",
      threadId: "thread",
      ownerMessageId: "owner",
      contextProjectIds: ["p"],
      requestId: "stable-request",
      causalContextId: "captured-context",
      questions: [
        {
          prompt: "Which result?",
          multiSelect: false,
          allowCustom: false,
          options: [{ label: "Keep" }, { label: "Review" }],
        },
      ],
    },
  });
  const request = vi.fn(async () => {
    throw new Error("Host unreachable");
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  cleanups.push(() => {
    root.unmount();
    container.remove();
  });
  await act(async () =>
    root.render(
      createElement(AssistantOwnerQuestions, {
        questions: [],
        environmentId: "host",
        visibleProjectIds: ["p"],
        request,
      }),
    ),
  );
  const retry = () =>
    [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Retry"),
    );
  expect(container.textContent).toContain("Saving this question could not be confirmed");

  await act(async () => retry()?.click());

  expect(request).toHaveBeenCalledTimes(1);
  expect(container.textContent).toContain(
    "Could not be confirmed after retry. Check the Host connection.",
  );
  expect(container.textContent).not.toContain("Saving this question could not be confirmed");
  expect(container.textContent).toContain("Which result?");
  expect(pendingOwnerQuestionPresentations(localStorage, "host")).toHaveLength(1);
  expect(retry()).toBeTruthy();
});
