// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
const remoteState = vi.hoisted(() => ({ failed: false }));
vi.mock("../../connections/model/connections", () => ({
  useRemoteMachines: () => ({
    machines: remoteState.failed
      ? []
      : [{ id: "remote", name: "Office", environmentId: "remote-host" }],
    loading: false,
    error: remoteState.failed ? "Could not load paired Hosts" : undefined,
  }),
}));
vi.mock("../../../shared/i18n", () => ({
  t: (value: string) => value,
  useT: () => (value: string) => value,
}));
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("../../../shared/ui/Modal", () => ({
  Modal: ({ children, footer }: { children: React.ReactNode; footer: React.ReactNode }) =>
    createElement("div", null, children, footer),
  ModalActions: ({ children }: { children: React.ReactNode }) =>
    createElement("div", null, children),
}));
vi.mock("../../../shared/ui/Button", () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) =>
    createElement("button", props, children),
}));
vi.mock("../../../shared/ui/Select", () => ({
  Select: ({
    label,
    value,
    onValueChange,
    options,
  }: {
    label: string;
    value: string;
    onValueChange: (value: string) => void;
    options: { value: string; label: string }[];
  }) =>
    createElement(
      "label",
      null,
      label,
      createElement(
        "select",
        {
          value,
          onChange: (event: React.ChangeEvent<HTMLSelectElement>) =>
            onValueChange(event.target.value),
        },
        options.map((option) =>
          createElement("option", { value: option.value, key: option.value }, option.label),
        ),
      ),
    ),
}));
vi.mock("../../../shared/ui/TextField", () => ({
  TextField: ({
    label,
    ...props
  }: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) =>
    createElement("label", null, label, createElement("input", props)),
}));
vi.mock("../../../shared/ui/InlineError", () => ({
  InlineError: ({ children }: { children: React.ReactNode }) => createElement("p", null, children),
}));
import { AssistantRemoteAccess } from "./AssistantRemoteAccess";
it("does not turn a failed paired Host read into an empty list", async () => {
  remoteState.failed = true;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div"),
    root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        createElement(AssistantRemoteAccess, {
          threadId: "failed-read",
          environmentId: "origin",
          sourceStatus: "registered",
          open: true,
          onClose: vi.fn(),
        }),
      ),
    );
    expect(container.textContent).toContain("Could not load paired Hosts");
    expect(container.textContent).not.toContain("No other paired Host is available.");
  } finally {
    await act(async () => root.unmount());
    remoteState.failed = false;
    vi.unstubAllGlobals();
  }
});
it("shows selected Room readiness, paired Host and policy denial without enabling a grant", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div"),
    root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        createElement(AssistantRemoteAccess, {
          threadId: "room",
          environmentId: "origin",
          sourceStatus: "registered",
          open: true,
          onClose: () => {},
        }),
      ),
    );
    expect(container.textContent).toContain("This Room is registered on its original Host.");
    expect(container.textContent).toContain("Office (remote-host)");
    expect(container.textContent).toContain("The target project must be visible");
    expect(
      [...container.querySelectorAll("button")].find((button) => button.textContent === "Connect")
        ?.disabled,
    ).toBe(true);
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
it("retains an uncertain original request and inspects it without issuing again", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  invoke.mockReset();
  invoke
    .mockRejectedValueOnce(new Error("connection lost"))
    .mockResolvedValueOnce({ state: "uncertain" });
  const container = document.createElement("div"),
    root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        createElement(AssistantRemoteAccess, {
          threadId: "pending-room",
          environmentId: "origin",
          sourceStatus: "registered",
          open: true,
          onClose: () => {},
        }),
      ),
    );
    const select = container.querySelector("select")!;
    await act(async () => {
      select.value = "remote";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const input = container.querySelector("input")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        input,
        "project",
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const button = (label: string) =>
      [...container.querySelectorAll("button")].find((item) => item.textContent === label)!;
    await act(async () => button("Connect").click());
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls[0][0]).toBe("room_delegation_issue");
    expect(button("Connect").disabled).toBe(true);
    await act(async () => button("Inspect request").click());
    expect(invoke.mock.calls[1][0]).toBe("room_delegation_issue_status");
    expect(invoke.mock.calls[1][1].requestId).toBe(invoke.mock.calls[0][1].requestId);
  } finally {
    await act(async () => root.unmount());
    localStorage.clear();
    vi.unstubAllGlobals();
  }
});
it("keeps prepared project IDs separate for each Room during view switches", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div"),
    root = createRoot(container);
  const render = (threadId: string) =>
    root.render(
      createElement(AssistantRemoteAccess, {
        key: threadId,
        threadId,
        environmentId: "host",
        sourceStatus: "registered",
        open: true,
        onClose: () => {},
      }),
    );
  try {
    await act(async () => render("one"));
    const input = container.querySelector("input")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "project-one");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(input.value).toBe("project-one");
    await act(async () => render("two"));
    expect(container.querySelector("input")!.value).toBe("");
    await act(async () => render("one"));
    expect(container.querySelector("input")!.value).toBe("project-one");
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
it("renders nothing until opened and offers no trigger button of its own", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div"),
    root = createRoot(container);
  const props = {
    threadId: "closed-room",
    environmentId: "host",
    sourceStatus: "registered",
  } as const;
  try {
    await act(async () =>
      root.render(
        createElement(AssistantRemoteAccess, { ...props, open: false, onClose: () => {} }),
      ),
    );
    expect(container.querySelector("button")).toBeNull();
    const onClose = vi.fn();
    await act(async () =>
      root.render(createElement(AssistantRemoteAccess, { ...props, open: true, onClose })),
    );
    const close = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Close",
    )!;
    await act(async () => close.click());
    expect(onClose).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
