// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { CrewMemberForm } from "./CrewMemberForm";
import type { CrewAgent } from "../model/crew";
import type { HostModelCatalog } from "../../connections/model/protocol";

vi.mock("./MemberModelSection", () => ({ MemberModelSection: () => null }));
vi.mock("./MemberToolsPicker", () => ({ MemberToolsPicker: () => null }));
vi.mock("./MemberAvatar", () => ({ MemberAvatar: () => null }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
it("keeps the Host group-name UTF16 budget without splitting an emoji", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const change = vi.fn();
  try {
    await act(async () =>
      root.render(
        createElement(CrewMemberForm, {
          cwd: "/project",
          catalog: {} as HostModelCatalog,
          agent: {
            id: "member",
            name: "Name",
            role: "specialist",
            instructions: "",
            candidates: [],
          } as unknown as CrewAgent,
          onChange: change,
          groups: true,
          compact: true,
        }),
      ),
    );
    const field = container.querySelector<HTMLInputElement>(
      'input[placeholder="UI, Mobile, Backend…"]',
    )!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        field,
        `${"a".repeat(39)}🚀`,
      );
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      field.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      );
    });
    expect(change).toHaveBeenCalledWith({ groups: ["a".repeat(39)] });
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});
