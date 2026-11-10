// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ServerSnippets } from "./ServerSnippets";
import { saveSshSnippet } from "../model/sshSnippets";
import { copyText } from "../../../platform/tauri/clipboard";
vi.mock("../../../platform/tauri/clipboard", () => ({
  copyText: vi.fn().mockResolvedValue(undefined),
}));
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
it("mount/restore never inserts; explicit insertion exposes target and requires remote Enter", async () => {
  saveSshSnippet({ serverId: "a", name: "Status", command: "git status" });
  const insert = vi.fn().mockResolvedValue(undefined);
  await act(async () =>
    root.render(
      createElement(ServerSnippets, {
        serverId: "a",
        serverName: "Personal SSH",
        onInsert: insert,
      }),
    ),
  );
  expect(insert).not.toHaveBeenCalled();
  expect(container.textContent).toContain("Personal SSH");
  const find = (text: string) =>
    [...container.querySelectorAll("button")].find((button) => button.textContent?.includes(text))!;
  await act(async () => find("Status").click());
  expect(insert).not.toHaveBeenCalled();
  expect(container.querySelector("textarea")?.value).toBe("git status");
  await act(async () => find("Insert into terminal").click());
  expect(insert).toHaveBeenCalledExactlyOnceWith("git status");
  expect(
    [...container.querySelectorAll('[role="status"]')].some((status) =>
      status.textContent?.includes("Press Enter"),
    ),
  ).toBe(true);
});
it("does not expose commands belonging to another server", async () => {
  saveSshSnippet({ serverId: "a", name: "SecretTarget", command: "pwd" });
  await act(async () =>
    root.render(createElement(ServerSnippets, { serverId: "b", onInsert: vi.fn() })),
  );
  expect(container.textContent).not.toContain("SecretTarget");
  const insert = [...container.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("Insert into terminal"),
  )!;
  expect(insert.getAttribute("disabled")).not.toBeNull();
});

it("confirms save inside its action and clears confirmation when the draft changes", async () => {
  saveSshSnippet({ serverId: "a", name: "Status", command: "git status" });
  await act(async () => root.render(createElement(ServerSnippets, { serverId: "a" })));
  const find = (text: string) =>
    [...container.querySelectorAll("button")].find((button) => button.textContent === text)!;
  await act(async () => find("Statusv1").click());
  await act(async () =>
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(find("Saved")).toBeTruthy();
  expect(
    [...container.querySelectorAll('[role="status"]')].filter(
      (status) => status.textContent === "Saved" && !status.classList.contains("sr-only"),
    ),
  ).toHaveLength(0);
  await act(async () => {
    const field = container.querySelector("textarea")!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      field,
      "pwd",
    );
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(find("Save")).toBeTruthy();
  expect(find("Saved")).toBeUndefined();
});

it("offers working copy without terminal insertion when no prompt capability is supplied", async () => {
  saveSshSnippet({ serverId: "a", name: "Status", command: "git status" });
  await act(async () => root.render(createElement(ServerSnippets, { serverId: "a" })));
  const find = (text: string) =>
    [...container.querySelectorAll("button")].find((button) => button.textContent?.includes(text));
  expect(find("Insert into terminal")).toBeUndefined();
  await act(async () => find("Status")!.click());
  await act(async () => find("Copy command")!.click());
  expect(copyText).toHaveBeenCalledWith("git status");
  expect(find("Copied")).toBeTruthy();
  expect(
    [...container.querySelectorAll('[role="status"]')].some(
      (status) => status.textContent === "Copied",
    ),
  ).toBe(true);
});
