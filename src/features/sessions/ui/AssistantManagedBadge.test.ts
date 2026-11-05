// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
const identity = vi.hoisted(() => ({ name: "Arif", read: vi.fn() }));
vi.mock("../../assistant/model/assistantClient", () => ({
  useAssistantIdentity: () => {
    identity.read();
    return identity;
  },
}));
vi.mock("../../../shared/i18n", () => ({
  t: (key: string, values?: Record<string, string>) =>
    key.replace(/\{(p\d+)\}/g, (_, key) => values?.[key] ?? ""),
  useT: () => (key: string) => key,
  useLocale: () => "en",
}));
import { AssistantManagedBadge } from "./AssistantManagedBadge";

it("renders only Host-managed metadata and updates the chosen name without creating an action", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(AssistantManagedBadge)));
    expect(identity.read).not.toHaveBeenCalled();
    expect(container.textContent).toBe("");
    const management = {
      assistant: true as const,
      jobId: "job-one",
      managedAt: 1,
    };
    await act(async () => root.render(createElement(AssistantManagedBadge, { management })));
    expect(container.textContent).toBe("Managed by Arif");
    expect(container.querySelector("button")).toBeNull();
    identity.name = "Ayşe";
    await act(async () =>
      root.render(createElement(AssistantManagedBadge, { management, compact: true })),
    );
    expect(container.querySelector('[aria-label="Managed by Ayşe"]')).not.toBeNull();
    expect(container.querySelector("svg")).not.toBeNull();
    identity.read.mockClear();
    await act(async () =>
      root.render(
        createElement(AssistantManagedBadge, {
          management,
          compact: true,
          local: false,
        }),
      ),
    );
    expect(container.querySelector('[aria-label="Managed session"]')).not.toBeNull();
    expect(identity.read).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
