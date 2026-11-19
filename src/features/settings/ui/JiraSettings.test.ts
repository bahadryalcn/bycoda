// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { JiraSettings } from "./JiraSettings";
import {
  loadHiddenJiraProjectIds,
  loadAllowedJiraBoardIds,
  jiraBackgroundSyncEnabled,
  saveHiddenJiraProjectIds,
  saveAllowedJiraBoardIds,
} from "../../inbox/model/jira";

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
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === "jira_status") return { connected: false, site: "", email: "" };
    if (command === "jira_set_config") {
      const config = args as { site: string; email: string; token: string };
      return {
        connected: Boolean(config.token),
        site: config.site,
        email: config.email,
      };
    }
    if (command === "jira_list_projects") return [{ id: "10000", key: "ENG", name: "Engineering" }];
    if (command === "jira_list_boards")
      return [{ id: 7, name: "Engineering board", kind: "kanban", projectId: "10000" }];
    throw new Error(`Unexpected command: ${command}`);
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  localStorage.clear();
  vi.unstubAllGlobals();
});

async function input(label: string, value: string) {
  const field = container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function pickOption(name: string) {
  const checkbox = Array.from(container.querySelectorAll<HTMLLabelElement>("label.inbox-scope-row"))
    .find((row) => row.textContent?.includes(name))!
    .querySelector<HTMLInputElement>("input[type=checkbox]")!;
  await act(async () => checkbox.click());
  return checkbox;
}

async function submit() {
  await act(async () => {
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

it("reveals the typed Jira token with the shared control while preserving its value", async () => {
  await act(async () => root.render(createElement(JiraSettings)));
  await input("Jira API token", "fixture-token");
  const field = container.querySelector<HTMLInputElement>('input[aria-label="Jira API token"]')!;
  expect(field.type).toBe("password");
  await act(async () =>
    container.querySelector<HTMLButtonElement>('button[aria-label="Show password"]')!.click(),
  );
  expect(field.type).toBe("text");
  expect(field.value).toBe("fixture-token");
  expect(document.activeElement).toBe(field);
  await act(async () =>
    container.querySelector<HTMLButtonElement>('button[aria-label="Hide password"]')!.click(),
  );
  expect(field.type).toBe("password");
});

it("shows progress on the active Jira operation without labelling a successful connection as disconnecting", async () => {
  let finishProjects!: () => void;
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === "jira_status") return { connected: false, site: "", email: "" };
    if (command === "jira_set_config") return { connected: true, ...(args as object) };
    if (command === "jira_list_projects")
      return new Promise((resolve) => {
        finishProjects = () => resolve([{ id: "1", key: "ENG", name: "Engineering" }]);
      });
    if (command === "jira_list_boards") return [];
    throw new Error(`Unexpected command: ${command}`);
  });
  await act(async () => root.render(createElement(JiraSettings)));
  await input("Jira site", "example.atlassian.net");
  await input("Atlassian email", "test@example.com");
  await input("Jira API token", "test-key");
  await submit();
  const disconnect = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.getAttribute("aria-label") === "Account actions",
  )!;
  expect(disconnect).toBeDefined();
  expect(disconnect.getAttribute("aria-busy")).not.toBe("true");
  expect(container.textContent).not.toContain("Disconnecting");
  expect(
    Array.from(container.querySelectorAll<HTMLButtonElement>('button[aria-busy="true"]')).some(
      (button) => button.textContent?.includes("Loading"),
    ),
  ).toBe(true);
  await act(async () => finishProjects());
  expect(disconnect.disabled).toBe(false);
});

it("connects Jira, synchronizes project filters, and disconnects", async () => {
  await act(async () => root.render(createElement(JiraSettings)));
  await input("Jira site", "acme.atlassian.net");
  await input("Atlassian email", "ada@example.com");
  await input("Jira API token", "secret");
  await submit();
  expect(invoke).toHaveBeenCalledWith("jira_set_config", {
    site: "acme.atlassian.net",
    email: "ada@example.com",
    token: "secret",
  });
  expect(container.textContent).toContain("ada@example.com");
  const email = container.querySelector<HTMLButtonElement>('[aria-label="Reveal email"]')!;
  expect(email.querySelector("span[aria-hidden]")?.className).toContain("blur-[5px]");
  await act(async () => email.click());
  expect(email.getAttribute("aria-label")).toBe("Hide email");
  await act(async () => email.click());
  expect(email.getAttribute("aria-label")).toBe("Reveal email");
  expect(container.querySelector('input[type="password"]')).toBeNull();
  expect(jiraBackgroundSyncEnabled()).toBe(false);
  await pickOption("Engineering board");
  expect(loadAllowedJiraBoardIds()).toEqual([7]);
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>(
        '[aria-label="Automatically refresh Jira in the background"]',
      )!
      .click(),
  );
  expect(jiraBackgroundSyncEnabled()).toBe(true);
  const project = await pickOption("Engineering");
  expect(project.checked).toBe(false);
  expect(loadHiddenJiraProjectIds()).toEqual(["10000"]);
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[aria-label="Account actions"]')!.click(),
  );
  await act(async () => document.querySelector<HTMLElement>('[role="menuitem"]')!.click());
  await act(async () =>
    [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')]
      .find((button) => button.textContent?.includes("Disconnect"))!
      .click(),
  );
  expect(invoke).toHaveBeenCalledWith("jira_set_config", {
    site: "",
    email: "",
    token: "",
  });
  expect(container.querySelector<HTMLInputElement>('input[type="password"]')!.value).toBe("");
});

it("shows authentication errors without claiming a successful connection", async () => {
  await act(async () => root.render(createElement(JiraSettings)));
  await input("Jira site", "acme");
  await input("Atlassian email", "ada@example.com");
  await input("Jira API token", "bad-token");
  vi.mocked(invoke).mockRejectedValueOnce(new Error("Jira email or API token is invalid"));
  await submit();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("invalid");
  expect(container.querySelector("form")).not.toBeNull();
  expect(container.querySelector<HTMLInputElement>('input[aria-label="Jira site"]')?.value).toBe(
    "acme",
  );
  expect(
    container.querySelector<HTMLInputElement>('input[aria-label="Atlassian email"]')?.value,
  ).toBe("ada@example.com");
  expect(
    container.querySelector<HTMLInputElement>('input[aria-label="Jira API token"]')?.value,
  ).toBe("bad-token");
  expect(container.textContent).not.toContain("Projects");
  await submit();
  expect(container.textContent).toContain("ada@example.com");
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

it("preserves project and board permissions when reconnecting", async () => {
  saveHiddenJiraProjectIds(["10000"]);
  saveAllowedJiraBoardIds([7]);
  await act(async () => root.render(createElement(JiraSettings)));
  await input("Jira site", "acme.atlassian.net");
  await input("Atlassian email", "ada@example.com");
  await input("Jira API token", "secret");
  await submit();
  expect(loadHiddenJiraProjectIds()).toEqual(["10000"]);
  expect(loadAllowedJiraBoardIds()).toEqual([7]);
  expect(boardRequests()).toEqual([{ projectIds: null }]);
  expect(container.textContent).toContain("0 of 0 boards selected");
});

function boardRequests() {
  return vi
    .mocked(invoke)
    .mock.calls.filter(([command]) => command === "jira_list_boards")
    .map(([, args]) => args);
}

function boardCheckbox(name: string) {
  return Array.from(container.querySelectorAll<HTMLLabelElement>("label.inbox-scope-row"))
    .find((row) => row.textContent?.includes(name))
    ?.querySelector<HTMLInputElement>("input[type=checkbox]");
}

it("scopes boards from one cached catalog when project checkboxes change", async () => {
  let finishBoards!: () => void;
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === "jira_status") return { connected: false, site: "", email: "" };
    if (command === "jira_set_config") return { connected: true, ...(args as object) };
    if (command === "jira_list_projects")
      return [
        { id: "10000", key: "ENG", name: "Engineering" },
        { id: "10001", key: "OPS", name: "Operations" },
      ];
    if (command === "jira_list_boards")
      return new Promise((resolve) => {
        finishBoards = () =>
          resolve([
            { id: 7, name: "Eng board", kind: "scrum", projectId: "10000" },
            { id: 8, name: "Ops board", kind: "kanban", projectId: "10001" },
          ]);
      });
    throw new Error(`Unexpected command: ${command}`);
  });
  await act(async () => root.render(createElement(JiraSettings)));
  await input("Jira site", "acme.atlassian.net");
  await input("Atlassian email", "ada@example.com");
  await input("Jira API token", "secret");
  await submit();
  expect(boardRequests()).toEqual([{ projectIds: null }]);
  await act(async () => finishBoards());
  expect(container.textContent).toContain("0 of 2 boards selected");
  await pickOption("Ops board");
  expect(loadAllowedJiraBoardIds()).toEqual([8]);

  const ops = await pickOption("Operations");
  expect(ops.checked).toBe(false);
  expect(loadHiddenJiraProjectIds()).toEqual(["10001"]);
  expect(boardCheckbox("Ops board")).toBeUndefined();
  expect(boardCheckbox("Eng board")!.disabled).toBe(false);
  expect(container.textContent).toContain("0 of 1 boards selected");
  // The hidden project's board choice stays persisted for when the project returns.
  expect(loadAllowedJiraBoardIds()).toEqual([8]);

  await pickOption("Engineering");
  expect(loadHiddenJiraProjectIds()).toEqual(["10000", "10001"]);
  expect(container.textContent).toContain("0 of 0 boards selected");

  await pickOption("Operations");
  await pickOption("Engineering");
  expect(boardCheckbox("Ops board")!.checked).toBe(true);
  expect(boardCheckbox("Ops board")!.disabled).toBe(false);
  expect(container.textContent).toContain("1 of 2 boards selected");
  // Every checkbox above narrowed the first catalog instead of starting another request.
  expect(boardRequests()).toEqual([{ projectIds: null }]);
});

it("filters projects by name or key without changing saved scope", async () => {
  await act(async () => root.render(createElement(JiraSettings)));
  await input("Jira site", "acme.atlassian.net");
  await input("Atlassian email", "ada@example.com");
  await input("Jira API token", "secret");
  await submit();
  expect(container.textContent).toContain("1 of 1 projects selected");
  await act(async () => {
    const search = container.querySelector<HTMLInputElement>(
      'input[aria-label="Search projects"], input[placeholder="Search projects"]',
    )!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      search,
      "unmatched",
    );
    search.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(container.textContent).toContain("No matching projects");
  expect(loadHiddenJiraProjectIds()).toEqual([]);
  await act(async () => {
    const search = container.querySelector<HTMLInputElement>(
      'input[aria-label="Search projects"], input[placeholder="Search projects"]',
    )!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, "eng");
    search.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const project = await pickOption("Engineering");
  expect(project.checked).toBe(false);
  expect(container.textContent).toContain("0 of 1 projects selected");
  expect(loadHiddenJiraProjectIds()).toEqual(["10000"]);
});

it("names the background refresh setting, not Inbox scope, when its save fails and keeps the saved value", async () => {
  localStorage.setItem("bycoda.jiraBackgroundSync", "true");
  const base = vi.mocked(invoke).getMockImplementation()!;
  vi.mocked(invoke).mockImplementation(async (command, args) =>
    command === "jira_status"
      ? { connected: true, site: "acme.atlassian.net", email: "ada@example.com" }
      : base(command, args),
  );
  const original = Storage.prototype.setItem;
  const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
    this: Storage,
    key: string,
    value: string,
  ) {
    if (key === "bycoda.jiraBackgroundSync") throw new Error("Storage is full");
    return original.call(this, key, value);
  });
  await act(async () => root.render(createElement(JiraSettings)));
  for (let round = 0; round < 3; round += 1)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  const toggle = container.querySelector<HTMLButtonElement>(
    '[role="switch"][aria-label="Automatically refresh Jira in the background"]',
  )!;
  await act(async () => toggle.click());
  expect(container.textContent).toContain(
    "The Jira background refresh setting is unavailable. Retry before changing it.",
  );
  expect(container.textContent).not.toContain("Saved Inbox scope");
  expect(localStorage.getItem("bycoda.jiraBackgroundSync")).toBe("true");
  expect(toggle.getAttribute("aria-checked")).toBe("true");
  setItem.mockRestore();
});
