// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AutomationAssistant } from "./AutomationAssistant";
import { resetRetainedState } from "../../../shared/hooks/useRetainedState";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => "/general") }));
vi.mock("../../../shared/ui/Modal", () => ({
  Modal: ({ children, footer }: any) => (
    <div>
      {children}
      {footer}
    </div>
  ),
}));
vi.mock("../../sessions/ui/ModelPicker", () => ({
  ModelPicker: ({ onChange }: any) => (
    <button onClick={() => onChange("codex", "new-model")}>Change model</button>
  ),
}));
vi.mock("../../projects/ui/SearchableProjectPicker", () => ({
  SearchableProjectPicker: () => null,
}));
const container = document.createElement("div");
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  resetRetainedState();
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function write(value: string) {
  const textarea = container.querySelector("textarea")!;
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
    textarea,
    value,
  );
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}
for (const change of ["prompt", "model"] as const) {
  it(`preserves newer ${change} while assistant delivery is pending`, async () => {
    let finish!: () => void;
    const onLaunch = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const onClose = vi.fn();
    await act(async () =>
      root.render(
        <AutomationAssistant
          cwd="/project"
          recents={[]}
          stateKey="assistant-race"
          onLaunch={onLaunch}
          onClose={onClose}
        />,
      ),
    );
    await act(async () => write("Submitted request"));
    await act(async () =>
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent?.includes("Open assistant"))!
        .click(),
    );
    expect(onLaunch).toHaveBeenCalledOnce();
    await act(async () => {
      if (change === "prompt") write("New unsent request");
      else
        [...container.querySelectorAll("button")]
          .find((button) => button.textContent === "Change model")!
          .click();
    });
    await act(async () => finish());
    expect(container.querySelector("textarea")!.value).toBe(
      change === "prompt" ? "New unsent request" : "Submitted request",
    );
    expect(onClose).not.toHaveBeenCalled();
  });
}

it("retires only the delivered unchanged request", async () => {
  const onClose = vi.fn();
  await act(async () =>
    root.render(
      <AutomationAssistant
        cwd="/project"
        recents={[]}
        stateKey="assistant-success"
        onLaunch={async () => undefined}
        onClose={onClose}
      />,
    ),
  );
  await act(async () => write("Delivered request"));
  await act(async () =>
    [...container.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("Open assistant"))!
      .click(),
  );
  expect(container.querySelector("textarea")!.value).toBe("");
  expect(onClose).toHaveBeenCalledOnce();
});
