// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OnboardingStatistics } from "./OnboardingStatistics";

const stats = vi.hoisted(() => ({
  choice: null as "on" | "off" | null,
  setChoice: vi.fn(),
}));
vi.mock("../../account", () => ({
  getStatsChoice: () => stats.choice,
  setStatsChoice: stats.setChoice,
  statsDisclosure: () => "Shared statistics disclosure",
  subscribeAnonymousStats: () => () => undefined,
}));

let root: Root;
let container: HTMLDivElement;

async function render() {
  await act(async () => root.render(createElement(OnboardingStatistics)));
}

function option(label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find(
    (item) => item.textContent?.trim() === label,
  );
  if (!found) throw new Error(`Option not found: ${label}`);
  return found;
}

describe("OnboardingStatistics choice", () => {
  beforeEach(() => {
    stats.choice = null;
    stats.setChoice.mockClear();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("keeps the disclosure behind the info icon instead of printing it inline", async () => {
    await render();
    expect(container.querySelector("li")).toBeNull();
    expect(container.textContent).not.toContain("Shared statistics disclosure");
  });

  it("shows no answer as selected while the choice is unset", async () => {
    await render();
    expect(option("Share anonymous statistics").getAttribute("aria-pressed")).toBe("false");
    expect(option("Don't share").getAttribute("aria-pressed")).toBe("false");
  });

  it("marks the saved answer as pressed and drops the follow-up alert", async () => {
    stats.choice = "off";
    await render();
    expect(option("Don't share").getAttribute("aria-pressed")).toBe("true");
    expect(option("Share anonymous statistics").getAttribute("aria-pressed")).toBe("false");
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("saves the chosen answer through setStatsChoice, keeping consent as an explicit choice", async () => {
    await render();
    await act(async () => option("Share anonymous statistics").click());
    expect(stats.setChoice).toHaveBeenCalledWith("on");
    await act(async () => option("Don't share").click());
    expect(stats.setChoice).toHaveBeenLastCalledWith("off");
  });
});
