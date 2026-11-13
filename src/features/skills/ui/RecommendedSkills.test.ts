// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { RecommendedSkills } from "./RecommendedSkills";
import { resetRetainedState } from "../../../shared/hooks/useRetainedState";
import { installRecommendedSkill, recommendedSkillInstallStatus } from "../model/skillInstallation";

vi.mock("../model/skillInstallation", () => ({
  installRecommendedSkill: vi.fn(),
  recommendedSkillInstallStatus: vi.fn(),
}));
vi.mock("../../../shared/ui/Modal", () => ({
  Modal: ({ children }: { children: unknown }) => children,
}));
vi.mock("../../../shared/ui/Select", () => ({
  Select: ({
    label,
    value,
    options,
    onValueChange,
  }: {
    label: string;
    value: string;
    options: { value: string; label: string }[];
    onValueChange: (value: string) => void;
  }) =>
    createElement(
      "select",
      {
        "aria-label": label,
        value,
        onChange: (event: Event) => onValueChange((event.target as HTMLSelectElement).value),
      },
      options.map((option) =>
        createElement("option", { key: option.value, value: option.value }, option.label),
      ),
    ),
}));
vi.mock("../../../shared/ui/SearchableSelect", () => ({
  SearchableSelect: ({
    value,
    onChange,
    options,
  }: {
    value: string;
    onChange: (value: string) => void;
    options: { value: string; label: string }[];
  }) =>
    createElement(
      "select",
      {
        "aria-label": "Provider",
        value,
        onChange: (event: Event) => onChange((event.target as HTMLSelectElement).value),
      },
      options.map((option) =>
        createElement("option", { key: option.value, value: option.value }, option.label),
      ),
    ),
}));

let container: HTMLDivElement;
let root: Root;
const onInstalled = vi.fn();
beforeEach(async () => {
  vi.clearAllMocks();
  resetRetainedState();
  sessionStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      createElement(RecommendedSkills, {
        cwd: "D:/repo",
        machines: [{ environmentId: "env-tailm", name: "tailm", cwd: "" }],
        installed: new Map([
          ["local", new Set(["frontend-design"])],
          ["env-tailm", new Set(["impeccable"])],
        ]),
        onInstalled,
        onClose: vi.fn(),
      }),
    ),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
const installButton = () =>
  container.querySelector<HTMLButtonElement>('button[aria-label="Install impeccable"]')!;
async function select(label: string, value: string) {
  await act(async () => {
    const input = container.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;
    input.value = value;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

it("installs only after explicit click with selected project and provider", async () => {
  expect(installRecommendedSkill).not.toHaveBeenCalled();
  await select("Installation scope", "project");
  await select("Provider", "codex");
  vi.mocked(installRecommendedSkill).mockImplementation(async (request) => ({
    requestId: request.requestId,
    skillId: request.skillId,
    status: "installed",
    path: "D:/repo/.codex/skills/impeccable/SKILL.md",
  }));
  await act(async () => installButton().click());
  expect(installRecommendedSkill).toHaveBeenCalledWith(
    expect.objectContaining({
      skillId: "impeccable",
      scope: "project",
      provider: "codex",
      cwd: "D:/repo",
    }),
    undefined,
  );
  expect(onInstalled).toHaveBeenCalledOnce();
  expect(installButton().disabled).toBe(true);
});

it("reconciles uncertain installation using original request identity", async () => {
  vi.mocked(installRecommendedSkill).mockRejectedValue(new Error("Connection lost"));
  await act(async () => installButton().click());
  const request = vi.mocked(installRecommendedSkill).mock.calls[0]![0];
  vi.mocked(recommendedSkillInstallStatus).mockResolvedValue({ ...request, status: "installed" });
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('button[aria-label="Check installation of impeccable"]')!
      .click(),
  );
  expect(installRecommendedSkill).toHaveBeenCalledOnce();
  expect(recommendedSkillInstallStatus).toHaveBeenCalledWith(request, undefined);
  expect(onInstalled).toHaveBeenCalledOnce();
});

it("names status checks accurately while reconciliation is pending", async () => {
  vi.mocked(installRecommendedSkill).mockRejectedValueOnce(new Error("Connection lost"));
  await act(async () => installButton().click());
  let finish!: (value: Awaited<ReturnType<typeof recommendedSkillInstallStatus>>) => void;
  vi.mocked(recommendedSkillInstallStatus).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const check = container.querySelector<HTMLButtonElement>(
    'button[aria-label="Check installation of impeccable"]',
  )!;
  await act(async () => check.click());
  expect(check.textContent).toContain("Checking…");
  expect(check.getAttribute("aria-label")).toBe("Checking…");
  expect(check.textContent).not.toContain("Installing…");
  await act(async () =>
    finish({ requestId: "request", skillId: "impeccable", status: "installed" }),
  );
  expect(installRecommendedSkill).toHaveBeenCalledOnce();
});

it("blocks duplicate install while first operation is pending", async () => {
  let finish!: (value: { requestId: string; skillId: string; status: "installed" }) => void;
  vi.mocked(installRecommendedSkill).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await act(async () => {
    installButton().click();
    installButton().click();
  });
  expect(container.querySelector('button[aria-label="Installing…"]')!.textContent).toContain(
    "Installing…",
  );
  expect(installRecommendedSkill).toHaveBeenCalledOnce();
  await act(async () =>
    finish({ requestId: "request", skillId: "impeccable", status: "installed" }),
  );
});

it("hides skills already installed on the selected computer and names other machines", async () => {
  const names = () => Array.from(container.querySelectorAll("li h3"), (item) => item.textContent);
  expect(names()).not.toContain("frontend-design");
  expect(names()).toContain("impeccable");
  expect(installButton().closest("li")?.textContent).toContain("On tailm");
  await act(async () => {
    Array.from(container.querySelectorAll<HTMLElement>('[role="radio"]'))
      .find((item) => item.textContent?.startsWith("Installed"))!
      .click();
  });
  expect(names()).toEqual(["frontend-design"]);
  expect(
    container.querySelector<HTMLButtonElement>('button[aria-label="Install frontend-design"]')
      ?.disabled,
  ).toBe(true);
});
