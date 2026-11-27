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
const input = (value: string) =>
  act(async () => {
    const field = container.querySelector("input")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
const leave = () =>
  act(async () => {
    container.querySelector("input")!.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });

it("saves metadata when a field is left, once per change, and reports a failed write", async () => {
  let finish!: () => void;
  vi.mocked(updateServerMetadata).mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  await act(async () => root.render(createElement(ServerOrganization, { server, expanded: true })));
  expect(container.querySelector('button[type="submit"]')).toBeNull();
  // Leaving an untouched field writes nothing.
  await leave();
  expect(updateServerMetadata).not.toHaveBeenCalled();
  await input("Production");
  await leave();
  expect(updateServerMetadata).toHaveBeenCalledTimes(1);
  expect(updateServerMetadata).toHaveBeenCalledWith("server-1", {
    group: "Production",
    tags: [],
    favorite: false,
  });
  await act(async () => finish());
  // The acknowledged value is not written again.
  await leave();
  expect(updateServerMetadata).toHaveBeenCalledTimes(1);
  vi.mocked(updateServerMetadata).mockRejectedValue(new Error("write failed"));
  await input("Edited draft");
  await leave();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "Couldn’t save server organization.",
  );
  expect(container.querySelector("input")?.value).toBe("Edited draft");
});

it("saves the favorite flag as soon as it flips", async () => {
  vi.mocked(updateServerMetadata).mockResolvedValue(undefined);
  await act(async () => root.render(createElement(ServerOrganization, { server, expanded: true })));
  await act(async () =>
    container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click(),
  );
  expect(updateServerMetadata).toHaveBeenCalledWith("server-1", {
    group: "",
    tags: [],
    favorite: true,
  });
});
