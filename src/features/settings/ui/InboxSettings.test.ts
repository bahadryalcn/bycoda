// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  AzureDevOpsSettings,
  GithubSettings,
  GitlabSettings,
  LinearSettings,
  InboxPage,
} from "./InboxSettings";
import { RevealedSetting } from "./settingsControls";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  vi.mocked(invoke).mockReset();
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
async function fill(label: string, value: string) {
  const input = container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function click(label: string) {
  const button = [...container.querySelectorAll("button")].find((item) =>
    item.textContent?.includes(label),
  )!;
  expect(button).toBeDefined();
  await act(async () => button.click());
}

it.each([
  [GitlabSettings, "gitlab_status", "gitlab_set_config", "GitLab URL", "GitLab access token"],
  [
    AzureDevOpsSettings,
    "azure_devops_status",
    "azure_devops_set_config",
    "Azure DevOps organization URL",
    "Azure DevOps personal access token",
  ],
] as const)(
  "preserves %s credentials after a failed save and retries the same target",
  async (Component, statusCommand, saveCommand, urlLabel, tokenLabel) => {
    let fail = true;
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === statusCommand)
        return { connected: false, url: "https://initial.example.com" };
      if (command === saveCommand) {
        if (fail) throw new Error("Invalid token");
        return { connected: true, url: "https://target.example.com" };
      }
      throw new Error(`Unexpected command: ${command}`);
    });
    await act(async () => root.render(createElement(Component)));
    await fill(urlLabel, "https://target.example.com");
    await fill(tokenLabel, "keep-token");
    await click("Save and test connection");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Invalid token");
    expect(
      container.querySelector<HTMLInputElement>(`input[aria-label="${tokenLabel}"]`)?.value,
    ).toBe("keep-token");
    expect(
      container.querySelector<HTMLInputElement>(`input[aria-label="${urlLabel}"]`)?.value,
    ).toBe("https://target.example.com");
    fail = false;
    await click("Retry save and test");
    expect(invoke).toHaveBeenLastCalledWith(saveCommand, {
      url: "https://target.example.com",
      token: "keep-token",
    });
    expect(container.textContent).toContain("Configured");
    expect(container.querySelector('input[type="password"]')).toBeNull();
  },
);

it("does not overwrite an unsaved GitLab target when checking saved configuration", async () => {
  vi.mocked(invoke).mockResolvedValue({ connected: false, url: "https://saved.example.com" });
  await act(async () => root.render(createElement(GitlabSettings)));
  await fill("GitLab URL", "https://draft.example.com");
  await click("Check saved configuration");
  expect(container.querySelector<HTMLInputElement>('input[type="url"]')?.value).toBe(
    "https://draft.example.com",
  );
});

it("does not label a failed GitHub status read as a missing CLI", async () => {
  vi.mocked(invoke).mockRejectedValue(new Error("Host unavailable"));
  await act(async () => root.render(createElement(GithubSettings)));
  expect(container.textContent).toContain("Check failed");
  expect(container.textContent).not.toContain("Not installed");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("Host unavailable");
});

it("uses Linear save status and keeps a rejected credential for correction", async () => {
  vi.mocked(invoke).mockResolvedValue({ connected: false });
  await act(async () => root.render(createElement(LinearSettings)));
  await fill("Linear API key", "keep-key");
  await click("Save and test connection");
  expect(container.querySelector<HTMLInputElement>('input[type="password"]')?.value).toBe(
    "keep-key",
  );
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "Connection test failed",
  );
  expect(container.textContent).not.toContain("Configured");
});

it("separates a Linear team read failure from saved credentials and offers retry", async () => {
  let fail = true;
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === "linear_status") return { connected: true };
    if (command === "linear_list_teams") {
      if (fail) throw new Error("Teams unavailable");
      return [{ id: "team", key: "ENG", name: "Engineering" }];
    }
    throw new Error(`Unexpected command: ${command}`);
  });
  await act(async () => root.render(createElement(LinearSettings)));
  expect(container.textContent).toContain("Configured");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("Teams unavailable");
  fail = false;
  await click("Retry");
  expect(container.textContent).toContain("Engineering");
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

it.each([false, true])(
  "ignores an old Linear account refresh after reconnect (failure=%s)",
  async (failure) => {
    let reads = 0;
    let settle!: () => void;
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      if (command === "linear_status") return { connected: true };
      if (command === "linear_set_token") return { connected: !!(args as { token: string }).token };
      if (command === "linear_list_teams") {
        reads += 1;
        if (reads === 2)
          return new Promise((resolve, reject) => {
            settle = () =>
              failure
                ? reject(new Error("Old account unavailable"))
                : resolve([{ id: "old", key: "OLD", name: "Old account team" }]);
          });
        return [
          { id: "current", key: "NEW", name: reads > 2 ? "New account team" : "Initial team" },
        ];
      }
      throw new Error(`Unexpected command: ${command}`);
    });
    await act(async () => root.render(createElement(LinearSettings)));
    await click("Refresh teams");
    await click("Disconnect");
    await fill("Linear API key", "replacement-test-key");
    await click("Save and test connection");
    expect(container.textContent).toContain("New account team");
    await act(async () => settle());
    expect(container.textContent).toContain("New account team");
    expect(container.textContent).not.toContain("Old account");
  },
);

it("preserves drafts across provider tabs, supports keyboard navigation, and reveals searched providers", async () => {
  vi.mocked(invoke).mockResolvedValue({
    connected: false,
    installed: true,
    url: "https://gitlab.com",
  });
  const render = (revealed: string | null) =>
    createElement(RevealedSetting.Provider, { value: revealed }, createElement(InboxPage));
  await act(async () => root.render(render(null)));
  const tabs = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  expect(tabs).toHaveLength(5);
  await act(async () => tabs[1].click());
  await fill("GitLab access token", "unsaved-draft");
  await act(async () => tabs[3].click());
  expect(container.querySelectorAll('[role="tabpanel"]:not([hidden])')).toHaveLength(1);
  await act(async () => tabs[1].click());
  expect(
    container.querySelector<HTMLInputElement>('input[aria-label="GitLab access token"]')?.value,
  ).toBe("unsaved-draft");
  await act(async () =>
    tabs[1].dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })),
  );
  expect(tabs[4].getAttribute("aria-selected")).toBe("true");
  expect(document.activeElement).toBe(tabs[4]);
  await act(async () => root.render(render("jira")));
  expect(tabs[3].getAttribute("aria-selected")).toBe("true");
});

it.each([
  [GitlabSettings, "gitlab_status", "gitlab_set_config", "GitLab access token"],
  [
    AzureDevOpsSettings,
    "azure_devops_status",
    "azure_devops_set_config",
    "Azure DevOps personal access token",
  ],
] as const)(
  "shows local save progress and blocks repeat %s submissions",
  async (Component, statusCommand, saveCommand, tokenLabel) => {
    let finish!: () => void;
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === statusCommand) return { connected: false, url: "https://example.com" };
      if (command === saveCommand)
        return new Promise((resolve) => {
          finish = () => resolve({ connected: true, url: "https://example.com" });
        });
      throw new Error(`Unexpected command: ${command}`);
    });
    await act(async () => root.render(createElement(Component)));
    await fill(tokenLabel, "test-key");
    await click("Save and test connection");
    const saving = [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
      button.textContent?.includes("Saving and testing"),
    )!;
    expect(saving.getAttribute("aria-busy")).toBe("true");
    await act(async () => saving.click());
    expect(
      vi.mocked(invoke).mock.calls.filter(([command]) => command === saveCommand),
    ).toHaveLength(1);
    await act(async () => finish());
    expect(container.textContent).toContain("Configured");
    expect(container.querySelector('button[aria-busy="true"]')).toBeNull();
  },
);

it("keeps Linear team refresh local, preserves results while pending, and explains an empty result", async () => {
  let reads = 0;
  let finish!: () => void;
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === "linear_status") return { connected: true };
    if (command === "linear_list_teams") {
      reads += 1;
      if (reads === 1) return [{ id: "engineering", key: "ENG", name: "Engineering" }];
      return new Promise((resolve) => {
        finish = () => resolve([]);
      });
    }
    throw new Error(`Unexpected command: ${command}`);
  });
  await act(async () => root.render(createElement(LinearSettings)));
  await click("Refresh teams");
  const refresh = [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
    button.textContent?.includes("Refresh teams"),
  )!;
  expect(refresh.getAttribute("aria-busy")).toBe("true");
  expect(container.textContent).toContain("Engineering");
  expect(container.textContent).not.toContain("No teams available");
  await act(async () => refresh.click());
  expect(reads).toBe(2);
  await act(async () => finish());
  expect(refresh.getAttribute("aria-busy")).not.toBe("true");
  expect(container.textContent).toContain("No teams available. Refresh teams to try again.");
});
