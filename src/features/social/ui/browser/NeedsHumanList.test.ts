// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { NeedsHumanItem } from "../../model/socialActions";
import type { SocialClient } from "../../model/socialClient";
import { NeedsHumanList } from "./NeedsHumanList";

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

const item: NeedsHumanItem = {
  id: "n1",
  accountId: "acc",
  platform: "instagram",
  reason: "challenge",
  at: 1,
};

function clientWith(items: NeedsHumanItem[]) {
  const list = vi.fn(async () => ({ items }));
  const resolve = vi.fn(async () => undefined);
  const client = { browser: { needsHuman: { list, resolve } } } as unknown as SocialClient;
  return { client, list, resolve };
}

async function render(client: SocialClient) {
  await act(async () => {
    root.render(createElement(NeedsHumanList, { client, machineId: "machine" }));
  });
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
}

it("shows the empty hint when nothing waits for the owner", async () => {
  const { client } = clientWith([]);
  await render(client);
  expect(element.textContent).toContain("Nothing is waiting for you.");
});

it("lists the platform and reason, and resolves the item when the owner says it is done", async () => {
  const { client, list, resolve } = clientWith([item]);
  await render(client);
  expect(element.textContent).toContain("Instagram");
  expect(element.textContent).toContain("Security check");
  expect(element.textContent).not.toContain("https://");
  const done = [...element.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("I'm done"),
  );
  await act(async () => {
    done?.click();
  });
  expect(resolve).toHaveBeenCalledWith("n1");
  expect(list.mock.calls.length).toBeGreaterThanOrEqual(2);
});

it("shows a failure message instead of an empty list when the Host cannot be read", async () => {
  const client = {
    browser: {
      needsHuman: {
        list: vi.fn(async () => Promise.reject(new Error("offline"))),
        resolve: vi.fn(),
      },
    },
  } as unknown as SocialClient;
  await render(client);
  expect(element.textContent).toContain("Waiting items could not be loaded.");
});

it("reports how many items wait so the screen can show a count", async () => {
  const { client } = clientWith([item, { ...item, id: "n2" }]);
  const onCountChange = vi.fn();
  await act(async () => {
    root.render(createElement(NeedsHumanList, { client, machineId: "machine", onCountChange }));
  });
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
  expect(onCountChange).toHaveBeenLastCalledWith(2);
});
