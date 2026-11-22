// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { reportFailure, registerFailurePolicy } from "../../../shared/ui/reportFailure";
import { ToastRegion, toast } from "../../../shared/ui/ToastRegion";
import {
  classifyFailureLifetime,
  describeActionFailure,
  useGracedFailure,
} from "./transientFailure";

it.each([
  "Host is stopping.",
  "Host rejected request: [HOST_STOPPING] Host is stopping.",
  "RPC_WS_INTERRUPTED: Host is stopping.",
  "Request cancelled.",
  "Host rejected request: Request cancelled",
  "Host rejected request: [RPC_WS_RETRYABLE] Retry this read",
  "Host database is closing.",
  "Host database is closed.",
  "ETIMEDOUT: Command timed out before launch",
  new Error("Command timed out before launch"),
  new DOMException("The view changed", "AbortError"),
  { message: "Try this read again", retryable: true },
  ...[
    "HOST_STOPPING",
    "HOST_DB_CLOSING",
    "REQUEST_CANCELLED",
    "RPC_CANCELLED",
    "ABORT_ERR",
    "GIT_START_TIMEOUT",
    "HOST_RPC_DEADLINE",
    "RPC_TIMEOUT",
    "RPC_PROTOCOL",
    "RPC_HOST_UNAVAILABLE",
    "RPC_CONNECTION_INTERRUPTED",
    "RPC_WS_CANCELLED",
    "RPC_WS_DEADLINE",
    "RPC_WS_OVERLOAD",
    "RPC_WS_DETACHED",
    "RPC_WS_UNAVAILABLE",
    "RPC_WS_INTERRUPTED",
  ].map((code) => ({ code, message: "RPC failed" })),
])("classifies transient read failure %j", (error) => {
  expect(classifyFailureLifetime(error)).toBe("transient");
});

it.each([
  "Permission denied",
  "Host rejected request: Not found",
  "Invalid input",
  "[RPC_AUTHORIZATION] Pairing refused",
  "Unsupported host method",
  "Machine connection is disabled.",
  { message: "Permission denied", retryable: true },
  ...[
    "FILE_CHANGED",
    "EACCES",
    "ENOENT",
    "RPC_WS_VALIDATION",
    "RPC_WS_BLOCKED",
    "RPC_WS_SCHEMA",
    "RPC_WS_TLS",
    "RPC_WS_IDENTITY",
    "RPC_WS_UNSUPPORTED",
    "RPC_WS_DISABLED",
  ].map((code) => ({ code, message: "RPC failed", retryable: true })),
])("classifies permanent read failure %j", (error) => {
  expect(classifyFailureLifetime(error)).toBe("permanent");
});

const rootForTest = () => {
  const container = document.createElement("div");
  document.body.append(container);
  return { container, root: createRoot(container) };
};
const advance = (ms: number) => act(async () => vi.advanceTimersByTimeAsync(ms));

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it.each([
  { initial: "Host is stopping.", outage: 5_000, quiet: true },
  { initial: "RPC_WS_UNAVAILABLE: offline", outage: 11_000, quiet: false },
])("gives the mounted read a recovery window for $initial", async ({ initial, outage, quiet }) => {
  const { container, root } = rootForTest();
  let online = false;
  const read = vi.fn(async () => {
    if (!online) throw new Error("RPC_WS_UNAVAILABLE: offline");
    return "Updated data";
  });
  function Probe() {
    const [error, setError] = useState<unknown>(initial);
    const [value, setValue] = useState("Retained data");
    const failure = useGracedFailure({
      error,
      retry: () =>
        read().then((next) => {
          setValue(next);
          setError(undefined);
        }, setError),
    });
    return createElement("div", { "aria-busy": failure.pending }, failure.visibleError ?? value);
  }

  try {
    await act(async () => root.render(createElement(Probe)));
    expect(container.textContent).toBe("Retained data");
    await advance(2_000);
    expect(read).toHaveBeenCalledOnce();
    await advance(999);
    expect(container.textContent).toBe("Retained data");
    await advance(1);
    expect(container.textContent === "Retained data").toBe(quiet);
    if (outage === 5_000) {
      await advance(2_000);
      online = true;
    } else {
      await advance(3_000);
      expect(read).toHaveBeenCalledTimes(2);
      await advance(5_000);
      expect(container.textContent).toContain("Waiting for the connection");
      online = true;
    }
    await advance(quiet ? 1_000 : 3_000);
    expect(container.textContent).toBe("Updated data");
    expect(container.firstElementChild?.getAttribute("aria-busy")).toBe("false");
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

it("shows a permanent failure immediately and retires timers when the scope changes", async () => {
  const { container, root } = rootForTest();
  const retry = vi.fn();
  function Probe({ scope, error }: { scope: string; error: string }) {
    return useGracedFailure({ error, retry, scope }).visibleError ?? "";
  }
  try {
    act(() => root.render(createElement(Probe, { scope: "a", error: "Host is stopping." })));
    await advance(1_999);
    act(() => root.render(createElement(Probe, { scope: "b", error: "Permission denied" })));
    expect(container.textContent).toBe("Permission denied");
    await advance(8_000);
    expect(retry).not.toHaveBeenCalled();
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

it("announces only visible failures and never replays an uncertain action", async () => {
  const { container, root } = rootForTest();
  const onRecord = vi.fn();
  registerFailurePolicy(describeActionFailure);
  const retry = vi.fn(async () => {});
  try {
    act(() => root.render(createElement(ToastRegion, { onRecord })));
    const recovered = reportFailure(
      { code: "RPC_WS_UNAVAILABLE", message: "offline" },
      { toast, retry },
    );
    await advance(2_999);
    await recovered;
    expect(retry).toHaveBeenCalledOnce();
    expect(onRecord).not.toHaveBeenCalled();

    const sustained = reportFailure("Host rejected request: Request cancelled", { toast });
    await advance(2_999);
    expect(onRecord).not.toHaveBeenCalled();
    await advance(1);
    await sustained;
    expect(onRecord).toHaveBeenCalledOnce();
    expect(onRecord.mock.lastCall?.[0]).toMatchObject({ tone: "danger" });

    await act(() =>
      reportFailure(
        { code: "RPC_WS_INTERRUPTED", message: "offline", uncertain: true },
        { toast, retry },
      ),
    );
    expect(retry).toHaveBeenCalledOnce();
    expect(onRecord.mock.lastCall?.[0]?.message).toContain("outcome is unknown");
  } finally {
    act(() => {
      toast.dismissAll();
      root.unmount();
    });
    container.remove();
  }
});
