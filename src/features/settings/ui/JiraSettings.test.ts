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
      return [{ id: 7, name: "Engineering board", kind: "kanban" }];
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

async function submit() {
  await act(async () => {
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

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
  expect(email.querySelector("span")?.className).toContain("blur-[5px]");
  await act(async () => email.click());
  expect(email.getAttribute("aria-label")).toBe("Hide email");
  await act(async () => email.click());
  expect(email.getAttribute("aria-label")).toBe("Reveal email");
  expect(container.querySelector('input[type="password"]')).toBeNull();
  const checkboxes = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
  expect(checkboxes[1].checked).toBe(false);
  expect(checkboxes[2].checked).toBe(false);
  expect(jiraBackgroundSyncEnabled()).toBe(false);
  await act(async () => checkboxes[1].click());
  expect(loadAllowedJiraBoardIds()).toEqual([7]);
  await act(async () =>
    container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[2].click(),
  );
  expect(jiraBackgroundSyncEnabled()).toBe(true);
  const project = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  expect(project.checked).toBe(true);
  await act(async () => project.click());
  expect(loadHiddenJiraProjectIds()).toEqual(["10000"]);
  expect(project.checked).toBe(false);
  const disconnect = [...container.querySelectorAll("button")].find((button) =>
    [...button.querySelectorAll("span")].some(
      (span) => !span.closest('[aria-hidden="true"]') && span.textContent === "Disconnect",
    ),
  )!;
  await act(async () => disconnect.click());
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
  expect(invoke).not.toHaveBeenCalledWith("jira_list_boards", expect.anything());
});

it("filters projects by name or key without changing saved scope", async () => {
  await act(async () => root.render(createElement(JiraSettings)));
  await input("Jira site", "acme.atlassian.net");
  await input("Atlassian email", "ada@example.com");
  await input("Jira API token", "secret");
  await submit();
  await input("Search projects", "unmatched");
  expect(container.textContent).toContain("No matching projects");
  expect(loadHiddenJiraProjectIds()).toEqual([]);
  await input("Search projects", "eng");
  const project = container.querySelector<HTMLInputElement>(
    '.inbox-scope-list input[type="checkbox"]',
  )!;
  expect(project.checked).toBe(true);
  await act(async () => project.click());
  expect(container.textContent).toContain("0 of 1 projects selected");
  await input("Search projects", "");
  expect(project.checked).toBe(false);
  expect(loadHiddenJiraProjectIds()).toEqual(["10000"]);
});
