// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SELECTION_PROBE_MAX_FAILURES,
  SELECTION_PROBE_MS,
  useBrowserSelectionProbe,
} from "./useBrowserSelectionProbe";

let root: Root;
let host: HTMLDivElement;
let hidden = false;

type Probe = {
  enabled: boolean;
  probe: () => Promise<unknown>;
  idle?: () => boolean;
  onUnstable?: (failures: number) => void;
  onRecovered?: () => void;
  onLost?: () => void;
};

function show(props: Probe) {
  function Component() {
    useBrowserSelectionProbe({
      enabled: props.enabled,
      probe: props.probe,
      idle: props.idle ?? (() => true),
      onUnstable: props.onUnstable ?? (() => {}),
      onRecovered: props.onRecovered ?? (() => {}),
      onLost: props.onLost ?? (() => {}),
    });
    return null;
  }
  act(() => root.render(createElement(Component)));
}
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  hidden = false;
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  Reflect.deleteProperty(document, "hidden");
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("browser selection probe", () => {
  it("reads the status at a relaxed cadence, not every second", async () => {
    const probe = vi.fn().mockResolvedValue(undefined);
    show({ enabled: true, probe });
    await advance(SELECTION_PROBE_MS - 1);
    expect(probe).not.toHaveBeenCalled();
    await advance(1);
    expect(probe).toHaveBeenCalledTimes(1);
    await advance(SELECTION_PROBE_MS * 3);
    expect(probe).toHaveBeenCalledTimes(4);
  });

  it("keeps the selection through a transient failure and reports recovery", async () => {
    const probe = vi.fn().mockRejectedValueOnce(new Error("slow host")).mockResolvedValue({});
    const onUnstable = vi.fn();
    const onRecovered = vi.fn();
    const onLost = vi.fn();
    show({ enabled: true, probe, onUnstable, onRecovered, onLost });
    await advance(SELECTION_PROBE_MS);
    expect(onUnstable).toHaveBeenCalledWith(1);
    expect(onLost).not.toHaveBeenCalled();
    await advance(2000);
    expect(probe).toHaveBeenCalledTimes(2);
    expect(onRecovered).toHaveBeenCalledTimes(1);
    await advance(SELECTION_PROBE_MS * 2);
    expect(onUnstable).toHaveBeenCalledTimes(1);
    expect(onLost).not.toHaveBeenCalled();
  });

  it("gives the selection up only after consecutive failures and then stops reading", async () => {
    const probe = vi.fn().mockRejectedValue(new Error("offline"));
    const onUnstable = vi.fn();
    const onLost = vi.fn();
    show({ enabled: true, probe, onUnstable, onLost });
    await advance(SELECTION_PROBE_MS + 2000 * SELECTION_PROBE_MAX_FAILURES);
    expect(probe).toHaveBeenCalledTimes(SELECTION_PROBE_MAX_FAILURES);
    expect(onUnstable).toHaveBeenCalledTimes(SELECTION_PROBE_MAX_FAILURES - 1);
    expect(onLost).toHaveBeenCalledTimes(1);
    await advance(SELECTION_PROBE_MS * 4);
    expect(probe).toHaveBeenCalledTimes(SELECTION_PROBE_MAX_FAILURES);
  });

  it("does not count a failure run across a success", async () => {
    const probe = vi
      .fn()
      .mockRejectedValueOnce(new Error("blip"))
      .mockRejectedValueOnce(new Error("blip"))
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error("blip"))
      .mockRejectedValueOnce(new Error("blip"))
      .mockResolvedValue({});
    const onLost = vi.fn();
    show({ enabled: true, probe, onLost });
    await advance(SELECTION_PROBE_MS + 2000 * 2 + SELECTION_PROBE_MS + 2000 * 3);
    expect(onLost).not.toHaveBeenCalled();
  });

  it("does not read while the page is hidden and reads at once when it is shown", async () => {
    const probe = vi.fn().mockResolvedValue(undefined);
    show({ enabled: true, probe });
    hidden = true;
    await advance(SELECTION_PROBE_MS * 6);
    expect(probe).not.toHaveBeenCalled();
    hidden = false;
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("skips a read while another request is pending", async () => {
    const probe = vi.fn().mockResolvedValue(undefined);
    let idle = false;
    show({ enabled: true, probe, idle: () => idle });
    await advance(SELECTION_PROBE_MS * 3);
    expect(probe).not.toHaveBeenCalled();
    idle = true;
    await advance(SELECTION_PROBE_MS);
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("stops when the selection ends and ignores a read that settles afterwards", async () => {
    let fail: (cause: Error) => void = () => {};
    const probe = vi.fn(() => new Promise<void>((_resolve, reject) => (fail = reject)));
    const onUnstable = vi.fn();
    const onLost = vi.fn();
    show({ enabled: true, probe, onUnstable, onLost });
    await advance(SELECTION_PROBE_MS);
    expect(probe).toHaveBeenCalledTimes(1);
    show({ enabled: false, probe, onUnstable, onLost });
    await act(async () => fail(new Error("late")));
    await advance(SELECTION_PROBE_MS * 3);
    expect(probe).toHaveBeenCalledTimes(1);
    expect(onUnstable).not.toHaveBeenCalled();
    expect(onLost).not.toHaveBeenCalled();
  });
});
