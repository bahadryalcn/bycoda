// @vitest-environment happy-dom
import { act, createElement, Fragment, memo } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { AgentTranscript } from "./AgentTranscript";
import { PooledTranscript, TranscriptPool, TranscriptPoolOutlet } from "./TranscriptPool";
import { newSession } from "../model/session";
import { ApprovalDecisionProvider, useApprovalDecisionContext } from "./ApprovalDecisionContext";

it("keeps context consumers stable while reads follow the current original session", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const node = document.createElement("div");
  const root = createRoot(node);
  let session = newSession("codex", "G:/fixture");
  const dispatch = vi.fn();
  const getSession = () => session;
  let renders = 0;
  let context: ReturnType<typeof useApprovalDecisionContext> = null;
  const Consumer = memo(() => {
    renders++;
    context = useApprovalDecisionContext();
    return null;
  });
  const render = () => act(() => root.render(createElement(ApprovalDecisionProvider, {
    session, getSession, dispatch, children: createElement(Consumer),
  })));
  try {
    render();
    const original = context;
    session = { ...session, context: { ...session.context, used: 42 } };
    render();
    expect(renders).toBe(1);
    expect(context).toBe(original);
    expect(context!.session).toBe(session);
    expect(context!.dispatch).toBe(dispatch);
  } finally {
    act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});

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
    session.blocks = session.blocks.map((block) => ({
      ...block,
      approval: { ...block.approval!, decided: "allow" as const },
    }));
    render();
    expect(allow()).toBeUndefined();
  } finally {
    act(() => root.unmount());
    node.remove();
    vi.unstubAllGlobals();
  }
});
