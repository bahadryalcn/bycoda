// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { HostProject } from "../../../connections/model/protocol";
import type { SocialAccount, SocialPermission } from "../../model/social";
import type { SocialClient } from "../../model/socialClient";
import { AccountPermissions } from "./AccountPermissions";

let element: HTMLDivElement, root: Root;

beforeEach(() => {
  element = document.createElement("div");
  document.body.append(element);
  root = createRoot(element);
});

afterEach(() => {
  act(() => root.unmount());
  element.remove();
});

const projects = [{ id: "p1", name: "Alpha" }] as unknown as HostProject[];

const account = (patch: Partial<SocialAccount> = {}): SocialAccount =>
  ({
    id: "a1",
    platform: "instagram",
    name: "Studio",
    connected: true,
    paused: false,
    grants: {},
    executorId: "e1",
    ...patch,
  }) as unknown as SocialAccount;

function render(
  request: ReturnType<typeof vi.fn>,
  props: {
    account?: SocialAccount;
    projects?: HostProject[];
    disabled?: boolean;
    onChanged?: () => void;
  } = {},
) {
  const onChanged = props.onChanged ?? vi.fn();
  act(() =>
    root.render(
      createElement(AccountPermissions, {
        client: { request } as unknown as SocialClient,
        account: props.account ?? account(),
        projects: props.projects ?? projects,
        disabled: props.disabled ?? false,
        onChanged,
      }),
    ),
  );
  return onChanged;
}

function fieldset(legend: string) {
  const found = [...element.querySelectorAll("fieldset")].find(
    (node) => node.querySelector("legend")?.textContent === legend,
  );
  expect(found, `Missing group: ${legend}`).toBeTruthy();
  return found as HTMLFieldSetElement;
}

function checkbox(legend: string, label: string) {
  const row = [...fieldset(legend).querySelectorAll("label")].find(
    (node) => node.textContent === label,
  );
  expect(row, `Missing checkbox: ${label}`).toBeTruthy();
  return row?.querySelector("input") as HTMLInputElement;
}

function submit(legend: string) {
  const form = fieldset(legend).closest("form");
  return act(async () => {
    form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

const ASSISTANT = "Assistant permissions";
const PROJECT = "Reading and sending are separate permissions";

it("offers the Assistant only reading and drafting, never sending", () => {
  render(vi.fn());
  const labels = [...fieldset(ASSISTANT).querySelectorAll("label")].map((node) => node.textContent);
  expect(labels).toEqual(["Can read", "Prepare drafts"]);
});

it("saves the Assistant grant against the version that was read", async () => {
  const request = vi.fn(async () => ({}));
  const onChanged = render(request, {
    account: account({ assistantGrant: { permissions: ["read"], version: "v3" } }),
  });
  expect(checkbox(ASSISTANT, "Can read").checked).toBe(true);
  expect(checkbox(ASSISTANT, "Prepare drafts").checked).toBe(false);
  act(() => checkbox(ASSISTANT, "Prepare drafts").click());
  await submit(ASSISTANT);
  expect(request).toHaveBeenCalledExactlyOnceWith("accounts.assistantGrant", {
    accountId: "a1",
    permissions: ["read", "draft"],
    expectedVersion: "v3",
  });
  expect(onChanged).toHaveBeenCalledTimes(1);
});

it("sends no expected version for a first grant and keeps drafting dependent on reading", async () => {
  const request = vi.fn(async () => ({}));
  render(request);
  expect(checkbox(ASSISTANT, "Prepare drafts").disabled).toBe(true);
  act(() => checkbox(ASSISTANT, "Can read").click());
  expect(checkbox(ASSISTANT, "Prepare drafts").disabled).toBe(false);
  act(() => checkbox(ASSISTANT, "Prepare drafts").click());
  // Taking reading away takes drafting away with it.
  act(() => checkbox(ASSISTANT, "Can read").click());
  expect(checkbox(ASSISTANT, "Prepare drafts").checked).toBe(false);
  act(() => checkbox(ASSISTANT, "Can read").click());
  await submit(ASSISTANT);
  expect(request).toHaveBeenCalledExactlyOnceWith("accounts.assistantGrant", {
    accountId: "a1",
    permissions: ["read"],
    expectedVersion: null,
  });
});

it("tells the owner that Assistant access is paused while voice retirement is pending", () => {
  render(vi.fn(), {
    account: account({ assistantGrantPending: { permissions: ["read", "draft"] } }),
  });
  expect(element.textContent).toContain(
    "Assistant access is paused while voice retirement is pending.",
  );
  expect(checkbox(ASSISTANT, "Prepare drafts").checked).toBe(true);
});

it("keeps reading apart from sending when a project is granted access", async () => {
  const request = vi.fn(async () => ({}));
  const onChanged = render(request);
  act(() => checkbox(PROJECT, "Can read").click());
  await submit(PROJECT);
  expect(request).toHaveBeenCalledExactlyOnceWith("accounts.grants", {
    accountId: "a1",
    projectId: "p1",
    permissions: ["read"],
  });
  expect(onChanged).toHaveBeenCalledTimes(1);
});

it("adds and removes single project permissions without touching the others", async () => {
  const request = vi.fn(async () => ({}));
  const grants: Record<string, SocialPermission[]> = { p1: ["read", "draft", "publish"] };
  render(request, { account: account({ grants }) });
  expect(checkbox(PROJECT, "Publish").checked).toBe(true);
  expect(checkbox(PROJECT, "Can reply").checked).toBe(false);
  act(() => checkbox(PROJECT, "Publish").click());
  act(() => checkbox(PROJECT, "Can reply").click());
  await submit(PROJECT);
  expect(request).toHaveBeenCalledExactlyOnceWith("accounts.grants", {
    accountId: "a1",
    projectId: "p1",
    permissions: ["read", "draft", "reply"],
  });
});

it("asks for a project first when there is none and shows no project permissions", () => {
  render(vi.fn(), { projects: [] });
  expect(element.textContent).toContain(
    "Create a project first to give this account project access.",
  );
  expect([...element.querySelectorAll("legend")].some((node) => node.textContent === PROJECT)).toBe(
    false,
  );
});

it("says why access cannot be saved and keeps the edit when the Host refuses it", async () => {
  const request = vi.fn(async () => {
    throw new Error("The grant changed on another computer.");
  });
  const onChanged = render(request);
  act(() => checkbox(PROJECT, "Can read").click());
  await submit(PROJECT);
  expect(element.textContent).toContain("The grant changed on another computer.");
  expect(checkbox(PROJECT, "Can read").checked).toBe(true);
  expect(onChanged).not.toHaveBeenCalled();
});

it("locks every permission while the Host is offline", () => {
  render(vi.fn(), { disabled: true });
  for (const input of element.querySelectorAll<HTMLInputElement>("input[type=checkbox]"))
    expect(input.disabled).toBe(true);
  const save = [...element.querySelectorAll("button")].filter((node) =>
    ["Save permissions", "Save project access"].includes(node.textContent ?? ""),
  );
  expect(save).toHaveLength(2);
  for (const node of save) expect(node.disabled).toBe(true);
});

it("states that access does not approve a send", () => {
  render(vi.fn());
  expect(element.textContent).toContain(
    "Access applies only to this account and can be revoked here. Sending still requires the autonomy level below.",
  );
});
