// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type {
  AssistantMemory,
  AssistantResponse,
} from "../../../shared/model/host-contracts/assistant";
vi.mock("../../../shared/ui/Modal", () => ({
  Modal: ({ children, footer }: any) => createElement("section", null, children, footer),
  ModalActions: ({ children }: any) => createElement("div", null, children),
}));
import { MemoryEditor } from "./MemoryEditor";

it.each([false, true])(
  "retains newer edits and advances the saved memory identity (existing=%s)",
  async (existing) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const memory: AssistantMemory = {
      id: "original-memory",
      version: 3,
      createdAt: 1,
      updatedAt: 2,
      kind: "rule",
      text: "Before",
      scope: "all",
      source: "typed",
      quote: "Before",
      active: true,
      forbiddenTerms: [],
    };
    let complete!: (result: AssistantResponse) => void;
    const request = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<AssistantResponse>((resolve) => {
            complete = resolve;
          }),
      )
      .mockResolvedValue({ memory: { ...memory, version: 5 } });
    const onClose = vi.fn();
    const type = async (text: string) =>
      act(async () => {
        const field = container.querySelector("textarea")!;
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
          field,
          text,
        );
        field.dispatchEvent(new Event("input", { bubbles: true }));
      });
    const submit = async () =>
      act(async () =>
        container
          .querySelector("form")!
          .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
      );
    try {
      await act(async () =>
        root.render(
          createElement(MemoryEditor, { entry: existing ? memory : "new", request, onClose }),
        ),
      );
      await type("Submitted");
      await submit();
      await type("New unsent text");
      await act(async () => complete({ memory: { ...memory, version: 4, text: "Submitted" } }));
      expect(onClose).not.toHaveBeenCalled();
      expect(container.querySelector("textarea")!.value).toBe("New unsent text");
      await submit();
      expect(request.mock.calls[1][0]).toMatchObject({
        id: "original-memory",
        expectedVersion: 4,
        text: "New unsent text",
      });
      expect(onClose).toHaveBeenCalledTimes(1);
    } finally {
      await act(async () => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    }
  },
);
