// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { AssistantTelegramNotifications } from "./AssistantTelegramNotifications";

let root: Root | undefined;
let container: HTMLDivElement | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  container?.remove();
  root = undefined;
});

async function mount(
  request: Parameters<typeof AssistantTelegramNotifications>[0]["request"],
  environmentId?: string,
) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const onChange = vi.fn();
  await act(async () =>
    root!.render(
      createElement(AssistantTelegramNotifications, {
        request,
        environmentId,
        onChange,
        value: {
          notificationTelegram: {
            accountId: "saved-account",
            conversationId: "saved-conversation",
          },
        },
      }),
    ),
  );
  const load = [...container.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("Choose Telegram conversation"),
  )!;
  return { onChange, load };
}

it("reads only the original Host and preserves a saved destination when it becomes unavailable", async () => {
  const request = vi.fn(async () => ({ notificationTargets: [] }));
  const { load, onChange } = await mount(request, "original-environment");
  await act(async () => load.click());
  expect(request).toHaveBeenCalledWith({ op: "notifications.targets" }, "original-environment");
  expect(onChange).not.toHaveBeenCalled();
  expect(container!.textContent).toContain("Saved Telegram conversation");
  expect(container!.textContent).toContain("No allowed Telegram conversations.");
});

it("does not fall back to the current Host when the original Host is unavailable", async () => {
  const request = vi.fn(async () => ({ notificationTargets: [] }));
  const { load, onChange } = await mount(request);
  await act(async () => load.click());
  expect(request).not.toHaveBeenCalled();
  expect(onChange).not.toHaveBeenCalled();
  expect(container!.textContent).toContain("Selected Host is unavailable.");
});
