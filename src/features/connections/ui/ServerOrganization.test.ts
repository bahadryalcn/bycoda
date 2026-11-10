// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ServerOrganization } from "./ServerOrganization";
import { updateServerMetadata, type ServerRecord } from "../model/serverInventory";

vi.mock("../model/serverInventory", () => ({ updateServerMetadata: vi.fn() }));
const server: ServerRecord = {
  id: "server-1",
  name: "Server",
  kind: "ssh",
  sshEndpoint: { host: "server.invalid", user: "owner", port: 22 },
  metadata: { tags: [], favorite: false },
};
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
const submit = () =>
  act(async () => {
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
const input = (value: string) =>
  act(async () => {
    const field = container.querySelector("input")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });

it("confirms only acknowledged metadata saves and clears the action on edits or failure", async () => {
  let finish!: () => void;
  vi.mocked(updateServerMetadata).mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  await act(async () => root.render(createElement(ServerOrganization, { server, expanded: true })));
  await input("Production");
  await submit();
  expect(container.querySelector("button")?.getAttribute("aria-busy")).toBe("true");
  expect(container.querySelector("button")?.textContent).not.toBe("Saved");
  await submit();
  expect(updateServerMetadata).toHaveBeenCalledTimes(1);
  await act(async () => finish());
  expect(container.querySelector("button")?.textContent).toBe("Saved");
  expect(
    [...container.querySelectorAll('[role="status"]')].filter(
      (status) => !status.classList.contains("sr-only"),
    ),
  ).toHaveLength(0);
  await input("Edited draft");
  expect(container.querySelector("button")?.textContent).toBe("Save");
  vi.mocked(updateServerMetadata).mockRejectedValue(new Error("write failed"));
  await submit();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "Couldn’t save server organization.",
  );
  expect(container.querySelector("button")?.textContent).toBe("Save");
  expect(container.querySelector("input")?.value).toBe("Edited draft");
});
