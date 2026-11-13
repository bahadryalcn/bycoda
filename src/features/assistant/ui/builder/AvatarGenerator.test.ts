// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { AvatarGenerator } from "./AvatarGenerator";
import { requestAssistantAvatar } from "../../model/assistantBuilderClient";

vi.mock("../../model/assistantBuilderClient", () => ({
  requestAssistantAvatar: vi.fn(async () => "image:generated"),
  assistantBuilderFailureDetail: String,
}));

it("confirms IME text without generating, then generates on a separate Enter", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const generated = vi.fn();
  try {
    await act(async () =>
      root.render(
        createElement(AvatarGenerator, {
          initialPrompt: "静かな狐",
          onGenerated: generated,
        }),
      ),
    );
    const input = container.querySelector("input")!;
    for (const composing of [{ isComposing: true }, { keyCode: 229 }]) {
      await act(async () =>
        input.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Enter",
            bubbles: true,
            ...composing,
          }),
        ),
      );
    }
    expect(requestAssistantAvatar).not.toHaveBeenCalled();
    await act(async () =>
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
    );
    expect(requestAssistantAvatar).toHaveBeenCalledExactlyOnceWith({
      prompt: "静かな狐",
      provider: "codex",
    });
    expect(generated).toHaveBeenCalledExactlyOnceWith("image:generated");
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
