// @vitest-environment happy-dom
import { act, createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DecisionModelsClient } from "../model/decisionModelsClient";
import { formatBytes } from "../../../shared/i18n/format";
import type {
  HardwareInfo,
  InstallState,
  LocalPlan,
  LocalRecommendation,
} from "../model/decisionTypes";
import { LocalInstallWizard } from "./LocalInstallWizard";
import {
  bodyText,
  buttonByText,
  clickButton,
  mountDecisionUi,
  settleDecisionUi,
  unmountDecisionUi,
} from "./decisionTestDom";

const hardware: HardwareInfo = {
  ramBytes: 16 * 1024 ** 3,
  freeRamBytes: 8 * 1024 ** 3,
  cpus: 8,
  gpus: [],
  freeDiskBytes: 100 * 1024 ** 3,
};

const plan: LocalPlan = {
  modelId: "clef-flash-9b",
  name: "Clef Flash 9B",
  installable: true,
  files: [{ fileName: "clef-flash-9b.gguf", sizeBytes: 5 * 1024 ** 3 }],
  downloadBytes: 5 * 1024 ** 3,
  freeDiskBytes: 100 * 1024 ** 3,
  fits: true,
};

function createClient(options: {
  recommendation: LocalRecommendation;
  hardwareFailures?: number;
  plan?: LocalPlan;
  /** A Host that advertises install progress and cancel. Default: an older Host with only `install`. */
  tracked?: boolean;
}) {
  let failures = options.hardwareFailures ?? 0;
  const mocks = {
    hardware: vi.fn(async () => {
      if (failures > 0) {
        failures -= 1;
        throw new Error("probe failed");
      }
      return hardware;
    }),
    recommend: vi.fn(async () => options.recommendation),
    plan: vi.fn(async () => options.plan ?? plan),
    install: vi.fn(async () => ({ state: "installed" as const })),
    installSupported: vi.fn(async () => options.tracked ?? false),
    installStart: vi.fn(async (): Promise<InstallState> => ({ state: "running" })),
    installProgress: vi.fn(async (): Promise<InstallState> => ({ state: "idle" })),
    cancelInstall: vi.fn(async () => ({ cancelled: true })),
  };
  const client = {
    local: {
      hardware: mocks.hardware,
      recommend: mocks.recommend,
      plan: mocks.plan,
      install: mocks.install,
      installSupported: mocks.installSupported,
      installStart: mocks.installStart,
      installProgress: mocks.installProgress,
      cancelInstall: mocks.cancelInstall,
    },
  } as unknown as DecisionModelsClient;
  return { client, mocks };
}

let mounted: ReturnType<typeof mountDecisionUi> | null = null;

afterEach(() => {
  unmountDecisionUi(mounted);
  mounted = null;
  vi.useRealTimers();
  vi.clearAllMocks();
});

async function renderWizard(
  client: DecisionModelsClient,
  onChooseApi = vi.fn(),
  onClose = vi.fn(),
) {
  const onInstalled = vi.fn();
  mounted = mountDecisionUi(
    createElement(LocalInstallWizard, {
      client,
      catalog: [],
      onChooseApi,
      onInstalled,
      onClose,
    }),
  );
  await settleDecisionUi();
  return { onChooseApi, onClose, onInstalled };
}

const running: InstallState = {
  state: "running",
  progress: {
    modelId: "clef-flash-9b",
    fileName: "clef-flash-9b.gguf",
    fileIndex: 0,
    fileCount: 1,
    bytesDone: 1024 ** 3,
    bytesTotal: 5 * 1024 ** 3,
  },
};

/** Only the poll timer is faked, so the settle helper keeps its real timeout. */
async function pollOnce() {
  await act(async () => {
    vi.advanceTimersByTime(1_000);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function openInstallStep(client: DecisionModelsClient) {
  const view = await renderWizard(client);
  clickButton("Continue");
  await settleDecisionUi();
  clickButton("Continue");
  await settleDecisionUi();
  return view;
}

describe("LocalInstallWizard", () => {
  it("never offers install on an insufficient machine and leads to the API path", async () => {
    const { client, mocks } = createClient({
      recommendation: { tier: "insufficient", modelId: "clef-flash-9b" },
    });
    const { onChooseApi } = await renderWizard(client);
    clickButton("Continue");
    await settleDecisionUi();
    expect(bodyText()).toContain("not suited to local use");
    expect(buttonByText("Install")).toBeUndefined();
    clickButton("Choose an API provider");
    expect(onChooseApi).toHaveBeenCalledTimes(1);
    expect(mocks.install).not.toHaveBeenCalled();
  });

  it("prevents dismissal while installation is pending and restores it after settlement", async () => {
    const { client, mocks } = createClient({
      recommendation: { tier: "strong", modelId: "clef-flash-9b" },
    });
    let resolveInstall!: (value: { state: "installed" }) => void;
    mocks.install.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveInstall = resolve;
        }),
    );
    const { onClose } = await renderWizard(client);
    clickButton("Continue");
    await settleDecisionUi();
    clickButton("Continue");
    clickButton("Install");
    await settleDecisionUi();
    const close = document.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!;
    const backdrop = document.querySelector<HTMLElement>("[data-modal-layer]")!;
    act(() => {
      close.click();
      backdrop.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(close.disabled).toBe(true);
    await act(async () => resolveInstall({ state: "installed" }));
    expect(close.disabled).toBe(false);
    act(() => close.click());
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("installs the recommended model only after an explicit confirmation", async () => {
    const { client, mocks } = createClient({
      recommendation: { tier: "strong", modelId: "clef-flash-9b" },
    });
    await renderWizard(client);
    clickButton("Continue");
    await settleDecisionUi();
    clickButton("Continue");
    await settleDecisionUi();
    expect(mocks.install).not.toHaveBeenCalled();
    clickButton("Install");
    await settleDecisionUi();
    expect(mocks.install).toHaveBeenCalledWith({
      modelId: "clef-flash-9b",
      confirm: "INSTALL_DECISION_MODEL",
    });
    expect(bodyText()).toContain("Installed. You can start it from the source list.");
  });

  it("shows download progress from a Host that reports it and finishes when the install does", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const { client, mocks } = createClient({
      recommendation: { tier: "strong", modelId: "clef-flash-9b" },
      tracked: true,
    });
    mocks.installStart.mockResolvedValue(running);
    const { onInstalled } = await openInstallStep(client);
    expect(mocks.installStart).not.toHaveBeenCalled();
    clickButton("Install");
    await settleDecisionUi();
    expect(mocks.installStart).toHaveBeenCalledWith({
      modelId: "clef-flash-9b",
      confirm: "INSTALL_DECISION_MODEL",
    });
    expect(mocks.install).not.toHaveBeenCalled();
    expect(bodyText()).toContain(
      `Downloading ${formatBytes(1024 ** 3)} of ${formatBytes(5 * 1024 ** 3)}…`,
    );
    expect(buttonByText("Cancel install")).toBeDefined();
    mocks.installProgress.mockResolvedValue({
      state: "running",
      progress: { ...running.progress!, bytesDone: 3 * 1024 ** 3 },
    });
    await pollOnce();
    expect(bodyText()).toContain(
      `Downloading ${formatBytes(3 * 1024 ** 3)} of ${formatBytes(5 * 1024 ** 3)}…`,
    );
    expect(onInstalled).not.toHaveBeenCalled();
    mocks.installProgress.mockResolvedValue({ state: "installed" });
    await pollOnce();
    expect(bodyText()).toContain("Installed. You can start it from the source list.");
    expect(onInstalled).toHaveBeenCalledTimes(1);
    expect(buttonByText("Done")).toBeDefined();
  });

  it("cancels a running install on the Host and offers Install again", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const { client, mocks } = createClient({
      recommendation: { tier: "strong", modelId: "clef-flash-9b" },
      tracked: true,
    });
    mocks.installStart.mockResolvedValue(running);
    const { onInstalled } = await openInstallStep(client);
    clickButton("Install");
    await settleDecisionUi();
    clickButton("Cancel install");
    await settleDecisionUi();
    expect(mocks.cancelInstall).toHaveBeenCalledWith({ modelId: "clef-flash-9b" });
    mocks.installProgress.mockResolvedValue({ state: "cancelled" });
    await pollOnce();
    expect(bodyText()).toContain("Install cancelled. Nothing was kept.");
    expect(buttonByText("Cancel install")).toBeUndefined();
    expect(buttonByText("Install")?.disabled).toBe(false);
    expect(onInstalled).not.toHaveBeenCalled();
  });

  it("shows an install that is already running on the Host without starting another", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const { client, mocks } = createClient({
      recommendation: { tier: "strong", modelId: "clef-flash-9b" },
      tracked: true,
    });
    mocks.installProgress.mockResolvedValue(running);
    await renderWizard(client);
    await settleDecisionUi();
    expect(bodyText()).toContain(
      `Downloading ${formatBytes(1024 ** 3)} of ${formatBytes(5 * 1024 ** 3)}…`,
    );
    expect(mocks.installStart).not.toHaveBeenCalled();
    expect(mocks.install).not.toHaveBeenCalled();
  });

  it("reports an install the Host could not finish, with the Host's reason in the details", async () => {
    const { client, mocks } = createClient({
      recommendation: { tier: "strong", modelId: "clef-flash-9b" },
      tracked: true,
    });
    mocks.installStart.mockResolvedValue({ state: "failed", error: "Model file verification failed." });
    await openInstallStep(client);
    clickButton("Install");
    await settleDecisionUi();
    expect(bodyText()).toContain("This did not work. Try again.");
    expect(buttonByText("Install")?.disabled).toBe(false);
  });

  it("falls back to the awaited install on a Host without progress and cancel", async () => {
    const { client, mocks } = createClient({
      recommendation: { tier: "strong", modelId: "clef-flash-9b" },
    });
    await openInstallStep(client);
    clickButton("Install");
    await settleDecisionUi();
    expect(mocks.installStart).not.toHaveBeenCalled();
    expect(mocks.install).toHaveBeenCalledTimes(1);
    expect(buttonByText("Cancel install")).toBeUndefined();
  });

  it("shows the download size and free disk from the plan without downloading", async () => {
    const { client, mocks } = createClient({
      recommendation: { tier: "strong", modelId: "clef-flash-9b" },
    });
    await renderWizard(client);
    clickButton("Continue");
    await settleDecisionUi();
    expect(mocks.plan).toHaveBeenCalledWith({ modelId: "clef-flash-9b" });
    expect(bodyText()).toContain(
      `Download ${formatBytes(5 * 1024 ** 3)}. Free disk space: ${formatBytes(100 * 1024 ** 3)}.`,
    );
    expect(bodyText()).not.toContain("not shown yet");
    expect(mocks.install).not.toHaveBeenCalled();
  });

  it("warns when the download does not fit the free disk", async () => {
    const { client } = createClient({
      recommendation: { tier: "strong", modelId: "clef-flash-9b" },
      plan: { ...plan, fits: false, freeDiskBytes: 1024 ** 3 },
    });
    await renderWizard(client);
    clickButton("Continue");
    await settleDecisionUi();
    expect(bodyText()).toContain(
      `Not enough free disk space: ${formatBytes(5 * 1024 ** 3)} needed.`,
    );
    expect(buttonByText("Continue")?.disabled).toBe(true);
    expect(buttonByText("Install")).toBeUndefined();
    expect(buttonByText("Choose an API provider")).toBeDefined();
  });

  it("holds install while its plan is unknown and retries a failed plan before enabling Continue", async () => {
    const { client, mocks } = createClient({
      recommendation: { tier: "strong", modelId: "clef-flash-9b" },
    });
    mocks.plan.mockRejectedValueOnce(new Error("Disk unavailable"));
    await renderWizard(client);
    clickButton("Continue");
    await settleDecisionUi();
    expect(buttonByText("Continue")?.disabled).toBe(true);
    expect(mocks.install).not.toHaveBeenCalled();
    clickButton("Try again");
    await settleDecisionUi();
    expect(mocks.plan).toHaveBeenCalledTimes(2);
    expect(buttonByText("Continue")?.disabled).toBe(false);
  });

  it("offers a retry when the hardware check fails", async () => {
    const { client, mocks } = createClient({
      recommendation: { tier: "cpu", modelId: "strands-decider-2b" },
      hardwareFailures: 1,
    });
    await renderWizard(client);
    expect(bodyText()).toContain("This did not work. Try again.");
    clickButton("Try again");
    await settleDecisionUi();
    expect(mocks.hardware).toHaveBeenCalledTimes(2);
    expect(bodyText()).toContain("Processor: 8 cores");
  });
});
