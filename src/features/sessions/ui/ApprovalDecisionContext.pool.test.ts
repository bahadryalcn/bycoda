// @vitest-environment happy-dom
import { act, createElement, Fragment } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { AgentTranscript } from "./AgentTranscript";
import { PooledTranscript, TranscriptPool, TranscriptPoolOutlet } from "./TranscriptPool";
import { newSession } from "../model/session";

it("carries the original approval context through the real pooled outlet and disables a handed-off decision", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const node = document.createElement("div");
  document.body.append(node);
  const root = createRoot(node),
    pool = new TranscriptPool();
  const session = newSession("codex", "G:/original-project");
  session.blocks = [
    {
      id: "original-approval",
      role: "approval",
      text: "Original pending tool",
      approval: { requestId: 837 },
    },
  ];
  const dispatch = vi.fn();
  const transcript = () =>
    createElement(AgentTranscript, {
      sessionId: session.id,
      blocks: session.blocks,
      visible: true,
      approvalContext: { session, dispatch },
      onApproval: vi.fn(),
    });
  const render = () =>
    act(() =>
      root.render(
        createElement(
          Fragment,
          null,
          createElement(PooledTranscript, { pool, sessionId: session.id, children: transcript() }),
          createElement(TranscriptPoolOutlet, { pool }),
        ),
      ),
    );
  try {
    render();
    const allow = () =>
      [...node.querySelectorAll<HTMLButtonElement>("button")].find(
        (button) => button.textContent === "Allow",
      )!;
    expect(allow()).toBeDefined();
    expect(node.textContent).not.toContain("Open this request in its conversation");
    await act(async () => allow().click());
    expect(dispatch).toHaveBeenCalledWith(session.id, 837, "allow", expect.any(Object));
    expect(allow().disabled).toBe(true);
    expect(node.textContent).toContain("Waiting for confirmation");
    render();
    expect(allow().disabled).toBe(true);
    act(() => allow().click());
    expect(dispatch).toHaveBeenCalledTimes(1);
  } finally {
    act(() => root.unmount());
    node.remove();
    vi.unstubAllGlobals();
  }
});
