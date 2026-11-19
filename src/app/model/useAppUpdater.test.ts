// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { saveUpdateChannel } from "../../features/settings/model/updateChannel";
import { settleUpdateCheck } from "./updateProbeBackoff";
import type { UpdaterSnapshot } from "./updater";
import { useAppUpdater } from "./useAppUpdater";

const mocks = vi.hoisted(() => ({ probe: vi.fn() }));
vi.mock("./updater", () => ({
  probeForUpdate: mocks.probe,
  readAppVersion: async () => "0.8.33",
  installPendingUpdate: vi.fn(),
}));

const MINUTE = 60 * 1000;

let latest: UpdaterSnapshot | undefined;
function Consumer() {
  latest = useAppUpdater().snapshot;
  return null;
}

const advance = (ms: number) => act(async () => vi.advanceTimersByTimeAsync(ms));

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance", "Date"] });
  settleUpdateCheck(false, true);
  // The real probe settles its feed check before it reports the failure.
  mocks.probe.mockImplementation(async () => {
    settleUpdateCheck(true, false);
    throw new Error("update endpoint did not respond with a successful status code");
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

it("backs off background probes while the feed fails and resumes after an explicit check", async () => {
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(createElement(Consumer)));
    expect(mocks.probe).toHaveBeenCalledTimes(1);

    await advance(59 * MINUTE);
    expect(mocks.probe).toHaveBeenCalledTimes(1);
    await advance(MINUTE);
    expect(mocks.probe).toHaveBeenCalledTimes(2);

    await advance(119 * MINUTE);
    expect(mocks.probe).toHaveBeenCalledTimes(2);
    await advance(MINUTE);
    expect(mocks.probe).toHaveBeenCalledTimes(3);

    // A check the user ran elsewhere restores the base interval without waiting four hours.
    await act(async () => settleUpdateCheck(false, true));
    await advance(29 * MINUTE);
    expect(mocks.probe).toHaveBeenCalledTimes(3);
    await advance(MINUTE);
    expect(mocks.probe).toHaveBeenCalledTimes(4);
  } finally {
    await act(async () => root.unmount());
  }
});

describe("channel switch during a running background probe", () => {
  let resolveBackground!: (update: null) => void;

  // The background probe stays in flight until the test settles it, like a slow feed request.
  function holdBackgroundProbe() {
    mocks.probe.mockImplementationOnce(
      () =>
        new Promise<null>((resolve) => {
          resolveBackground = resolve;
        }),
    );
  }

  afterEach(() => {
    saveUpdateChannel("stable");
  });

  it("answers the switch with a fresh check and drops the old channel's result", async () => {
    const root = createRoot(document.createElement("div"));
    try {
      holdBackgroundProbe();
      mocks.probe.mockResolvedValueOnce({ version: "0.8.34" });
      await act(async () => root.render(createElement(Consumer)));
      expect(mocks.probe).toHaveBeenCalledTimes(1);

      await act(async () => saveUpdateChannel("preview"));
      expect(mocks.probe).toHaveBeenCalledTimes(2);
      expect(latest).toMatchObject({ phase: "available", availableVersion: "0.8.34" });

      await act(async () => resolveBackground(null));
      expect(latest).toMatchObject({ phase: "available", availableVersion: "0.8.34" });
    } finally {
      await act(async () => root.unmount());
    }
  });

  it("reports a failed switch check instead of swallowing it", async () => {
    const root = createRoot(document.createElement("div"));
    try {
      holdBackgroundProbe();
      mocks.probe.mockRejectedValueOnce(new Error("feed unreachable"));
      await act(async () => root.render(createElement(Consumer)));

      await act(async () => saveUpdateChannel("preview"));
      expect(latest).toMatchObject({ phase: "error", error: "feed unreachable" });

      await act(async () => resolveBackground(null));
      expect(latest).toMatchObject({ phase: "error", error: "feed unreachable" });
    } finally {
      await act(async () => root.unmount());
    }
  });
});

it("keeps a failure wait across a remount instead of probing again", async () => {
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(createElement(Consumer)));
    expect(mocks.probe).toHaveBeenCalledTimes(1);

    await act(async () => root.render(null));
    await advance(20 * MINUTE);
    await act(async () => root.render(createElement(Consumer)));
    expect(mocks.probe).toHaveBeenCalledTimes(1);

    await advance(39 * MINUTE);
    expect(mocks.probe).toHaveBeenCalledTimes(1);
    await advance(MINUTE);
    expect(mocks.probe).toHaveBeenCalledTimes(2);
  } finally {
    await act(async () => root.unmount());
  }
});
