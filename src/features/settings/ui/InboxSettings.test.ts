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
} from "./InboxSettings";
import { GITHUB_CLI_INSTALL_WATCH_MS, GITHUB_CLI_POLL_MS } from "./useGithubCliStatus";
import { INTEGRATIONS, IntegrationsPage } from "./integrations/IntegrationsSettings";
import { RevealedSetting } from "../../../shared/ui/settings";

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
    expect(container.textContent).toContain("Verified");
    expect(container.querySelector('input[type="password"]')).toBeNull();
  },
);

it("does not overwrite an unsaved GitLab target when retrying the saved configuration read", async () => {
  // The status row appears only after a failed read; its Retry rereads the saved configuration.
  vi.mocked(invoke)
    .mockRejectedValueOnce(new Error("Host unavailable"))
    .mockResolvedValue({ connected: false, url: "https://saved.example.com" });
  await act(async () => root.render(createElement(GitlabSettings)));
  await fill("GitLab URL", "https://draft.example.com");
  await click("Retry");
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

const installingStatus = {
  connected: false,
  installed: false,
  authenticated: false,
  installing: true,
};
const badgeText = () => container.querySelector('[role="status"]')?.textContent;

it("keeps the GitHub CLI Installing state steady while it silently polls", async () => {
  vi.useFakeTimers();
  try {
    let reads = 0;
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command !== "git_github_status") throw new Error(`Unexpected command: ${command}`);
      reads += 1;
      // A fresh object per read, as `invoke` returns: an identical one would not re-render.
      return reads < 4
        ? { ...installingStatus }
        : { connected: true, installed: true, authenticated: true, installing: false };
    });
    await act(async () => root.render(createElement(GithubSettings)));
    expect(badgeText()).toBe("Installing");
    for (let poll = 1; poll <= 2; poll += 1) {
      await act(async () => vi.advanceTimersByTimeAsync(2000));
      // The row never falls back to Checking between background reads.
      expect(reads).toBe(poll + 1);
      expect(badgeText()).toBe("Installing");
      expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    }
    await act(async () => vi.advanceTimersByTimeAsync(2000));
    expect(badgeText()).toBe("Connected");
    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect(reads).toBe(4);
  } finally {
    vi.useRealTimers();
  }
});

it("stops watching a stuck GitHub CLI install and resumes only on an explicit check", async () => {
  // The watch deadline reads the monotonic clock; drive it from the fake clock.
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  const monotonic = vi.spyOn(performance, "now").mockImplementation(() => Date.now());
  try {
    let reads = 0;
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command !== "git_github_status") throw new Error(`Unexpected command: ${command}`);
      reads += 1;
      return { ...installingStatus };
    });
    await act(async () => root.render(createElement(GithubSettings)));
    // One act per poll: React flushes the state change that schedules the next read on exit.
    for (
      let elapsed = 0;
      elapsed < GITHUB_CLI_INSTALL_WATCH_MS + 4000;
      elapsed += GITHUB_CLI_POLL_MS
    )
      await act(async () => vi.advanceTimersByTimeAsync(GITHUB_CLI_POLL_MS));
    expect(badgeText()).toBe("Taking longer");
    const stopped = reads;
    expect(stopped).toBeLessThanOrEqual(GITHUB_CLI_INSTALL_WATCH_MS / GITHUB_CLI_POLL_MS + 2);
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(reads).toBe(stopped);
    await click("Check again");
    expect(reads).toBe(stopped + 1);
    expect(badgeText()).toBe("Installing");
    await act(async () => vi.advanceTimersByTimeAsync(GITHUB_CLI_POLL_MS));
    expect(reads).toBe(stopped + 2);
  } finally {
    monotonic.mockRestore();
    vi.useRealTimers();
  }
});

it("stops polling a GitHub CLI install when a background read fails and keeps retry", async () => {
  vi.useFakeTimers();
  try {
    let reads = 0;
    vi.mocked(invoke).mockImplementation(async () => {
      reads += 1;
      if (reads === 2) throw new Error("Desktop unavailable");
      return installingStatus;
    });
    await act(async () => root.render(createElement(GithubSettings)));
    await act(async () => vi.advanceTimersByTimeAsync(2000));
    expect(badgeText()).toBe("Check failed");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Desktop unavailable");
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(reads).toBe(2);
    await click("Check again");
    expect(badgeText()).toBe("Installing");
  } finally {
    vi.useRealTimers();
  }
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
  expect(container.textContent).toContain("API key saved on this computer");
  // Reading saved credentials never claims the provider accepted them.
  expect(container.querySelector('[data-state="verified"]')).toBeNull();
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
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Account actions"]')!.click(),
    );
    await act(async () => document.querySelector<HTMLElement>('[role="menuitem"]')!.click());
    await act(async () =>
      [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')]
        .find((button) => button.textContent?.includes("Disconnect"))!
        .click(),
    );
    await fill("Linear API key", "replacement-test-key");
    await click("Save and test connection");
    expect(container.textContent).toContain("New account team");
    await act(async () => settle());
    expect(container.textContent).toContain("New account team");
    expect(container.textContent).not.toContain("Old account");
  },
);

it("preserves drafts across services, offers every provider in the picker, and reveals searched providers", async () => {
  vi.mocked(invoke).mockResolvedValue({
    connected: false,
    installed: true,
    url: "https://gitlab.com",
  });
  const render = (revealed: string | null) =>
    createElement(RevealedSetting.Provider, { value: revealed }, createElement(IntegrationsPage));
  const trigger = () =>
    container.querySelector<HTMLButtonElement>('button[aria-label^="Services:"]')!;
  const options = () => [...document.querySelectorAll<HTMLElement>('[role="option"]')];
  const open = () => act(async () => trigger().click());
  const choose = (id: string) =>
    act(async () => options().find((option) => option.dataset.value === id)!.click());
  const pick = async (id: string) => {
    await open();
    await choose(id);
  };
  const gitlabToken = () =>
    container.querySelector<HTMLInputElement>('input[aria-label="GitLab access token"]');
  await act(async () => root.render(render(null)));
  // One choice per offered integration; paused messaging providers have none.
  await open();
  expect(options().map((option) => option.dataset.value)).toEqual(
    INTEGRATIONS.map((item) => item.id),
  );
  await choose("gitlab");
  await fill("GitLab access token", "unsaved-draft");
  await pick("jira");
  // The previous provider keeps its draft but is hidden, so only one service shows.
  expect(gitlabToken()?.closest("[hidden]")).not.toBeNull();
  await pick("gitlab");
  expect(gitlabToken()?.closest("[hidden]")).toBeNull();
  expect(gitlabToken()?.value).toBe("unsaved-draft");
  const lastId = INTEGRATIONS[INTEGRATIONS.length - 1]!;
  await pick(lastId.id);
  expect(trigger().getAttribute("aria-label")).toContain(lastId.name);
  await act(async () => root.render(render("jira")));
  expect(trigger().getAttribute("aria-label")).toContain("Jira");
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
    expect(container.textContent).toContain("Verified");
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
