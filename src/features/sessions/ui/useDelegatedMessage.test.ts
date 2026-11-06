// @vitest-environment happy-dom
import { act, createElement, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ComposerTurnOptions } from "../model/session";
import { useDelegatedMessage } from "./useDelegatedMessage";

type Message = ReturnType<typeof useDelegatedMessage>;

const container = document.createElement("div");
let root = createRoot(container);
let message: Message;

function Harness(props: Parameters<typeof useDelegatedMessage>[0]) {
  const current = useDelegatedMessage(props);
  useLayoutEffect(() => {
    message = current;
  });
  return null;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});

afterEach(() => {
  act(() => root.unmount());
  root = createRoot(container);
  vi.unstubAllGlobals();
});

function render(
  onSubmit: (text: string, options: ComposerTurnOptions) => boolean | void = vi.fn(() => true),
  { childSessionId = "child-a", blocked = false } = {},
) {
  act(() => root.render(createElement(Harness, { childSessionId, blocked, onSubmit })));
  return onSubmit;
}

it("sends the trimmed draft straight to the child and clears it once accepted", () => {
  const submit = render(vi.fn(() => true));
  act(() => message.setDraft("  Check the migration  "));
  act(() => message.send());
  expect(submit).toHaveBeenCalledOnce();
  expect(submit).toHaveBeenCalledWith("Check the migration", expect.any(Object));
  expect(message.draft).toBe("");
  expect(message.status).toBe("accepted");
});

it("does not block a running child: the same send path steers it or starts a turn", () => {
  // The hook has no busy gate: whether the child is steered or gets a new turn is
  // decided by the submit path it calls. Both states reach the same submit.
  const submit = render(vi.fn(() => true));
  act(() => message.setDraft("Also cover the edge case"));
  act(() => message.send());
  expect(submit).toHaveBeenCalledOnce();
  expect(submit.mock.calls[0][0]).toBe("Also cover the edge case");
});

it("does nothing without a child or with an empty draft", () => {
  const submit = render(
    vi.fn(() => true),
    { childSessionId: "" },
  );
  act(() => message.setDraft("Hello"));
  act(() => message.send());
  expect(submit).not.toHaveBeenCalled();

  render(submit, { blocked: true });
  act(() => message.send());
  expect(submit).not.toHaveBeenCalled();

  render(submit);
  act(() => message.setDraft("   "));
  act(() => message.send());
  expect(submit).not.toHaveBeenCalled();
});

it.each([false, "throw"])("restores the draft when the child rejects (%s)", (result) => {
  render(
    vi.fn(() => {
      if (result === "throw") throw new Error("offline");
      return false;
    }),
  );
  act(() => message.setDraft("Hello"));
  act(() => message.send());
  expect(message.draft).toBe("Hello");
  expect(message.status).toBe("rejected");
});

it("restores a late rejection without overwriting newer text", () => {
  let options: ComposerTurnOptions | undefined;
  const submit = render(
    vi.fn((_text: string, opts: ComposerTurnOptions) => {
      options = opts;
      return true;
    }),
  );
  act(() => message.setDraft("First message"));
  act(() => message.send());
  act(() => message.setDraft("New draft"));
  act(() => options?.onSendRejected?.());
  expect(message.draft).toBe("New draft\n\nFirst message");
  expect(message.status).toBe("rejected");
  expect(submit).toHaveBeenCalledOnce();
});

it("keeps a separate draft for each child across switches", () => {
  const submit = render();
  act(() => message.setDraft("For A"));
  render(submit, { childSessionId: "child-b" });
  expect(message.draft).toBe("");
  act(() => message.setDraft("For B"));
  render(submit, { childSessionId: "child-a" });
  expect(message.draft).toBe("For A");
  render(submit, { childSessionId: "child-b" });
  expect(message.draft).toBe("For B");
});

it("keeps a child's draft after its send was rejected, when another child is open", () => {
  let reject: ComposerTurnOptions | undefined;
  const submit = render(
    vi.fn((_text: string, opts: ComposerTurnOptions) => {
      reject = opts;
      return true;
    }),
  );
  act(() => message.setDraft("Pending"));
  act(() => message.send());
  render(submit, { childSessionId: "child-b" });
  act(() => reject?.onSendRejected?.());
  // The rejection belongs to child A; child B's empty draft stays untouched.
  expect(message.draft).toBe("");
  render(submit, { childSessionId: "child-a" });
  expect(message.draft).toBe("Pending");
  expect(message.status).toBe("rejected");
});
