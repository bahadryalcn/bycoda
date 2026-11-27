// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { SocialClient } from "../../model/socialClient";
import { defaultProgram, type ProgramDetail } from "../../model/socialProgram";
import { ContentProgramReview } from "./ContentProgramReview";

const { confirm } = vi.hoisted(() => ({ confirm: vi.fn() }));
vi.mock("../../../../shared/ui/ConfirmDialog", () => ({
  useConfirm: () => ({ confirm, dialog: null }),
}));

it("previews the schedule, approves the exact sample, and activates only after owner confirmation", async () => {
  const at = Date.UTC(2030, 0, 1, 12);
  const config = defaultProgram("project", at);
  const program: ProgramDetail["program"] = {
    ...config,
    id: "program",
    name: "Repeat launch",
    accountIds: ["account"],
    enabled: false,
    revision: 4,
    executorId: "host",
    generationCount: 0,
    imageGenerationCount: 0,
    generationDay: "",
    dailyGenerationCount: 0,
    createdAt: at,
    updatedAt: at,
    nextSequence: 0,
    nextAt: at,
  };
  const variant = {
    accountId: "account",
    text: "Reviewed caption",
    media: [],
    scheduledAt: at,
    factIds: [],
  };
  const sample: ProgramDetail["occurrences"][number] = {
    id: "sample",
    programId: "program",
    programRevision: 4,
    sequence: 0,
    scheduledAt: at,
    originalAt: at,
    revision: 6,
    targets: [
      {
        accountId: "account",
        platform: "youtube",
        status: "review",
        variant,
        approvals: {},
        generation: { attempts: 1, transitions: [] },
      },
    ],
  };
  const request = vi.fn(async (action: string, _input: Record<string, unknown>) => {
    switch (action) {
      case "programs.status":
        return { program, occurrences: [] };
      case "programs.preview-schedule":
        return { dates: [at] };
      case "programs.generate":
        return { program, occurrences: [sample] };
      case "programs.approve":
        return {
          program,
          occurrences: [{ ...sample, targets: [{ ...sample.targets[0], status: "ready" }] }],
        };
      case "programs.activate":
        return { ...program, enabled: true };
      default:
        throw new Error(action);
    }
  });
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const node = document.createElement("div");
  document.body.append(node);
  const root = createRoot(node);
  const onClose = vi.fn();
  const find = (text: string) =>
    [...document.body.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === text,
    );
  const click = async (text: string) => {
    await act(async () => find(text)!.click());
  };
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  try {
    await act(async () =>
      root.render(
        createElement(
          QueryClientProvider,
          { client: cache },
          createElement(ContentProgramReview, {
            id: program.id,
            client: { request } as unknown as SocialClient,
            accounts: [],
            available: true,
            onChange: vi.fn(),
            onClose,
          }),
        ),
      ),
    );
    await vi.waitFor(() => expect(find("Generate sample")).toBeDefined());
    await vi.waitFor(() => expect(document.body.textContent).toContain("Schedule preview"));
    expect(find("Activate program")?.getAttribute("aria-disabled")).toBe("true");
    await click("Generate sample");
    await vi.waitFor(() => expect(find("Approve sample")).toBeDefined());
    expect(document.body.textContent).toContain("Reviewed caption");
    await click("Approve sample");
    await vi.waitFor(() =>
      expect(find("Activate program")?.getAttribute("aria-disabled")).toBeNull(),
    );
    expect(request).toHaveBeenCalledWith("programs.approve", {
      id: "program",
      occurrenceId: "sample",
      accountId: "account",
      expectedRevision: 6,
      steps: config.approval.steps,
      confirm: true,
    });
    confirm.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await click("Activate program");
    expect(request.mock.calls.map(([action]) => action)).not.toContain("programs.activate");
    await click("Activate program");
    expect(request).toHaveBeenCalledWith("programs.activate", {
      id: "program",
      expectedRevision: 4,
      confirm: true,
    });
    expect(onClose).toHaveBeenCalledOnce();
  } finally {
    act(() => root.unmount());
    node.remove();
    cache.clear();
    vi.unstubAllGlobals();
  }
});
