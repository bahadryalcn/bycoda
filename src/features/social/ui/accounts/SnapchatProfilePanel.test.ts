// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SocialAccount } from "../../model/social";
import type { SocialClient } from "../../model/socialClient";
import { SnapchatProfilePanel } from "./SnapchatProfilePanel";

/** A control with a reason stays focusable: blocked is `disabled` or `aria-disabled`. */
const isBlocked = (
  node: { disabled?: boolean; getAttribute(name: string): string | null } | null | undefined,
) => Boolean(node?.disabled) || node?.getAttribute("aria-disabled") === "true";

let root: Root;
let element: HTMLElement;
const member: SocialAccount = {
  id: "member",
  platform: "snapchat",
  platformId: "web:snapchat:member:fixture",
  name: "Fixture member",
  accountType: "member",
  scopes: [],
  accessApproved: true,
  connected: true,
  connection: "browser",
  paused: false,
  executorId: "host",
  grants: {},
  createdAt: 1,
};

const button = (text: string, parent = document.body) =>
  [...parent.querySelectorAll("button")].find((node) => node.textContent?.trim() === text)!;

function setInput(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  element = document.createElement("div");
  document.body.append(element);
  root = createRoot(element);
});
afterEach(() => {
  act(() => root.unmount());
  element.remove();
  vi.unstubAllGlobals();
});

it("requires the owner to confirm creation and keeps the member draft after an uncertain result", async () => {
  const snapchatProfileRead = vi.fn(async () => ({ hasPublicProfile: false }));
  const snapchatProfileCreate = vi.fn(async () => {
    throw new Error("Fixture outcome unknown.");
  });
  const onChanged = vi.fn();
  const client = {
    snapchatProfileRead,
    snapchatProfileCreate,
  } as unknown as SocialClient;
  const render = (disabled: boolean) =>
    act(() =>
      root.render(
        createElement(SnapchatProfilePanel, {
          client,
          account: member,
          capabilities: [],
          disabled,
          onThisComputer: true,
          onChanged,
        }),
      ),
    );

  render(false);
  await act(async () => button("Read profile").click());
  expect(snapchatProfileRead).toHaveBeenCalledWith(member.id);
  act(() => setInput(element.querySelector("input")!, "Draft profile"));
  await act(async () => button("Create Public Profile").click());
  expect(snapchatProfileCreate).not.toHaveBeenCalled();

  render(true);
  await act(async () =>
    button(
      "Create Public Profile",
      document.querySelector<HTMLElement>('[role="dialog"]')!,
    ).click(),
  );
  expect(snapchatProfileCreate).not.toHaveBeenCalled();

  render(false);
  await act(async () =>
    button(
      "Create Public Profile",
      document.querySelector<HTMLElement>('[role="dialog"]')!,
    ).click(),
  );
  expect(snapchatProfileCreate).toHaveBeenCalledWith(member.id, {
    name: "Draft profile",
  });
  expect(onChanged).not.toHaveBeenCalled();
  expect(element.querySelector("input")?.value).toBe("Draft profile");
  expect(isBlocked(button("Create Public Profile"))).toBe(true);
  await act(async () => button("Read profile").click());
  expect(element.querySelector("input")?.value).toBe("Draft profile");
  expect(button("Create Public Profile").disabled).toBe(false);
});
