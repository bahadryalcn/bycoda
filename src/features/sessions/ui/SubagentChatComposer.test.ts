// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { newSession } from "../model/session";
import { SubagentChatComposer } from "./SubagentMessageForm";

vi.mock("@tauri-apps/api/core", async (original) => {
  const module = await original<typeof import("@tauri-apps/api/core")>();
  return {
    ...module,
    invoke: (command: string, args?: Parameters<typeof module.invoke>[1]) => {
      if (command === "list_project_files") return Promise.resolve([]);
      if (command === "write_attachment")
        return Promise.resolve(`/attachments/${(args as { name: string }).name}`);
      return module.invoke(command, args);
    },
  };
});
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: async () => () => {} }),
}));

it("shows real Steer and Queue controls and sends a pasted image with the skill prompt", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const session = { ...newSession("codex", "/repo"), busy: true };
  const onSubmit = vi.fn(() => true);
  try {
    await act(async () =>
      root.render(
        createElement(SubagentChatComposer, {
          name: "Reviewer",
          session,
          visible: true,
          remoteSession: true,
          remoteFeatures: { attachments: true, plan: false, draft: false, steer: true },
          onSubmit,
        }),
      ),
    );
    expect(container.querySelector('[aria-label="Add files or skills"]')).not.toBeNull();
    const textarea = container.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Message for Reviewer"]',
    )!;
    const type = (text: string) =>
      act(async () => {
        textarea.value = text;
        textarea.setSelectionRange(text.length, text.length);
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
      });
    await type("$review check this image");
    const file = new File(["image"], "review.png", { type: "image/png" });
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", {
      value: {
        getData: () => "",
        files: [file],
        items: [{ kind: "file", type: file.type, getAsFile: () => file }],
      },
    });
    await act(async () => {
      textarea.dispatchEvent(paste);
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    const steer = container.querySelector<HTMLButtonElement>('button[aria-description="Steer"]');
    expect(steer?.textContent).toContain("Steer");
    await act(async () => steer?.click());
    expect(onSubmit).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("$review check this image"),
      [expect.objectContaining({ name: "review.png", kind: "image", data: "aW1hZ2U=" })],
      expect.objectContaining({ followUpBehavior: "steer" }),
    );
    await type("Follow this after the current turn");
    const queue = container.querySelector<HTMLButtonElement>('button[aria-label="Queue message"]');
    expect(queue).not.toBeNull();
    await act(async () => queue?.click());
    expect(onSubmit).toHaveBeenNthCalledWith(
      2,
      "Follow this after the current turn",
      [],
      expect.objectContaining({ followUpBehavior: "queue" }),
    );
  } finally {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
