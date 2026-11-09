// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { settingsSectionsByGroup } from "../model/settings";
import { SettingsAccountRow, accountRowId, navigationGroups } from "./SettingsAccountRow";

const mocks = vi.hoisted(() => ({ state: { phase: "signed-out" } as unknown }));
vi.mock("../../account/hooks/useAccount", () => ({
  useAccount: () => ({ state: mocks.state }),
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("settings navigation account row", () => {
  it("drops the Account group from the category list", () => {
    const groups = navigationGroups(settingsSectionsByGroup());
    expect(groups.map((group) => group.id)).not.toContain("account");
    expect(groups.flatMap((group) => group.sections.map((section) => section.id))).not.toContain(
      "account",
    );
  });

  it("offers Sign in to a guest and selects the account section", async () => {
    const onSelect = vi.fn();
    await act(async () =>
      root.render(
        createElement(SettingsAccountRow, { section: "general", panelId: "p", onSelect }),
      ),
    );
    expect(container.querySelector(".bycoda-settings-category-label")!.textContent).toBe(
      "My account",
    );
    const row = container.querySelector("button")!;
    expect(row.textContent).toContain("Sign in");
    expect(row.getAttribute("aria-current")).toBeNull();
    await act(async () => row.click());
    expect(onSelect).toHaveBeenCalledWith("account");
  });

  it("marks the row current while the account section is open", async () => {
    await act(async () =>
      root.render(
        createElement(SettingsAccountRow, { section: "account", panelId: "p", onSelect: vi.fn() }),
      ),
    );
    expect(container.querySelector("button")!.getAttribute("aria-current")).toBe("true");
  });

  it("gives the account row the id that names the shared panel", async () => {
    await act(async () =>
      root.render(
        createElement(SettingsAccountRow, { section: "account", panelId: "p", onSelect: vi.fn() }),
      ),
    );
    expect(container.querySelector("button")!.id).toBe(accountRowId("p"));
  });
});
