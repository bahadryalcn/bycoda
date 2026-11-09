// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { Session } from "../../sessions/model/session";
import { useApprovalDecisionContext } from "../../sessions/ui/ApprovalDecisionContext";
import { DelegatedSessionRequests } from "./DelegatedSessionRequests";

const state = vi.hoisted(() => ({
  remote: {} as Record<string, unknown>,
  shell: undefined as unknown,
  approve: vi.fn(),
  answer: vi.fn(),
  machines: [{ id: "machine", environmentId: "env" }],
}));
vi.mock("../model/connections", () => ({
  useRemoteMachines: () => ({ machines: state.machines, loaded: true }),
  remoteSessionFor: () => "child",
}));
vi.mock("../model/remoteProjects", () => ({ remoteProjectFor: () => ({ environmentId: "env" }) }));
vi.mock("../model/sessionExecutionBinding", () => ({
  hostSessionBinding: () => undefined,
  hostExecutionProject: () => undefined,
}));
vi.mock("./RemoteSession", () => ({
  RemoteSession: (props: { shell: unknown; render: (value: unknown) => unknown }) => {
    state.shell = props.shell;
    return props.render(state.remote);
  },
}));
vi.mock("../../sessions/ui/AgentTranscriptActivity", () => ({
  ActivityRow: (props: { block: { id: string } }) => {
    const context = useApprovalDecisionContext();
    return createElement(
      "button",
      {
        onClick: () =>
          context?.dispatch(context.session.id, 11, "allow", { requestId: 11 } as never),
      },
      props.block.id,
    );
  },
}));
vi.mock("../../sessions/ui/ComposerQuestionForm", () => ({
  ComposerQuestionForm: (props: { onReply: (id: number, value: never) => void }) =>
    createElement("button", { onClick: () => props.onReply(7, {} as never) }, "Question"),
}));

it("uses the child's Host owner and removes answered requests", () => {
  const child = { id: "child", cwd: "/project", blocks: [] } as unknown as Session;
  const session = {
    ...child,
    blocks: [{ id: "approval", approval: { requestId: 11 } }],
    pendingQuestion: { requestId: 7, questions: [] },
  };
  state.remote = { session, onApproval: state.approve, onQuestionReply: state.answer };
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => root.render(createElement(DelegatedSessionRequests, { child, visible: true })));
  expect(state.shell).toBe(child);
  act(() => container.querySelectorAll("button")[0].click());
  expect(state.approve).toHaveBeenCalledWith("child", 11, "allow", { requestId: 11 });
  act(() => container.querySelectorAll("button")[1].click());
  expect(state.answer).toHaveBeenCalledWith("child", 7, {});
  state.remote = {
    ...state.remote,
    session: { ...session, blocks: [], pendingQuestion: undefined },
  };
  act(() => root.render(createElement(DelegatedSessionRequests, { child, visible: true })));
  expect(container.querySelectorAll("button")).toHaveLength(0);
  act(() => root.unmount());
});

it("does not mount a Host owner when machine identity is ambiguous", () => {
  const child = { id: "child", cwd: "/project", blocks: [] } as unknown as Session;
  const container = document.createElement("div");
  const root = createRoot(container);
  state.shell = undefined;
  state.machines = [
    { id: "first", environmentId: "env" },
    { id: "second", environmentId: "env" },
  ];
  act(() => root.render(createElement(DelegatedSessionRequests, { child, visible: true })));
  expect(state.shell).toBeUndefined();
  expect(container.textContent).toContain("unavailable");
  state.machines = [{ id: "first", environmentId: "env" }];
  act(() => root.render(createElement(DelegatedSessionRequests, { child, visible: true })));
  expect(state.shell).toBe(child);
  act(() => root.unmount());
});

it("keeps a background owner's notices out of the parent pane", () => {
  const child = { id: "child", cwd: "/project", blocks: [] } as unknown as Session;
  state.machines = [{ id: "machine", environmentId: "env" }];
  state.remote = {};
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() =>
    root.render(
      createElement(DelegatedSessionRequests, { child, visible: true, renderRequests: false }),
    ),
  );
  expect(state.shell).toBe(child);
  expect(container.firstElementChild?.hasAttribute("hidden")).toBe(true);
  act(() => root.unmount());
});
