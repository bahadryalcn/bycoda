// @vitest-environment happy-dom
import { parseDiagnosticLine } from "@bycoda/account-contracts";
import { beforeEach, describe, expect, it } from "vitest";
import { applyRemoteConnection } from "../../connections/model/remoteHealth";
import { currentViewName } from "../../../app/workspace/control/useNavigationBreadcrumbs";
import { recordHostConnection, recordNavigation, rpcErrorCode, traceHostRpc } from "./breadcrumbs";
import { clearUiLog, installUiLogBuffer, uiLogSnapshot } from "./uiLogBuffer";

const lines = () =>
  uiLogSnapshot()
    .split("\n")
    .filter(Boolean)
    .map((line) => parseDiagnosticLine(line));

beforeEach(() => clearUiLog());

describe("breadcrumbs", () => {
  it("records navigation by view and section only", () => {
    recordNavigation("settings", "appearance");
    const [line] = lines();
    expect(line?.category).toBe("ui.nav");
    expect(uiLogSnapshot()).toContain("section=appearance");
  });

  it("maps the open surface to a view name", () => {
    const base = {
      settingsOpen: false,
      searchViewOpen: false,
      inboxViewOpen: false,
      notesViewOpen: false,
      serversViewOpen: false,
      automationsViewOpen: false,
      socialBoardShown: false,
      taskBoardShown: false,
    } as never;
    expect(currentViewName(base)).toBe("conversation");
    expect(currentViewName({ ...(base as object), inboxViewOpen: true } as never)).toBe("inbox");
    expect(currentViewName({ ...(base as object), settingsOpen: true } as never)).toBe("settings");
  });

  it("records Host connection changes coming from the connection model", () => {
    applyRemoteConnection("env-1", { type: "ok", at: 1 });
    applyRemoteConnection("env-1", { type: "ok", at: 2 });
    const hostLines = lines().filter((line) => line?.category === "ui.host");
    expect(hostLines).toHaveLength(1);
    expect(uiLogSnapshot()).toContain("status=connected");
    recordHostConnection("unreachable", "connected");
    expect(uiLogSnapshot()).toContain("from=connected");
  });

  it("records a failed Host call with method, code and duration but never params or messages", async () => {
    const failing = Object.assign(new Error("secret prompt text"), { code: "RPC_TIMEOUT" });
    await expect(traceHostRpc("sessions.list", Promise.reject(failing))).rejects.toBe(failing);
    await expect(traceHostRpc("ok.call", Promise.resolve(1))).resolves.toBe(1);
    const text = uiLogSnapshot();
    expect(text).toMatch(
      /\[ui\.rpc\] request failed method=sessions\.list code=RPC_TIMEOUT ms=\d+/,
    );
    expect(text).not.toContain("secret");
    expect(text).not.toContain("ok.call");
  });

  it("falls back to the error class name, then a generic code", () => {
    expect(rpcErrorCode(new TypeError("x"))).toBe("TypeError");
    expect(rpcErrorCode({ code: "has spaces and a very long text ".repeat(4) })).toBe("error");
    expect(rpcErrorCode("boom")).toBe("string");
  });
});

describe("window hooks", () => {
  it("captures console, uncaught errors, rejections, focus and network", () => {
    installUiLogBuffer();
    console.error("bad thing", { a: 1 });
    window.dispatchEvent(
      new ErrorEvent("error", {
        message: "boom",
        filename: "http://x/assets/app.js",
        lineno: 4,
        colno: 2,
        error: new Error("boom"),
      }),
    );
    window.dispatchEvent(new Event("offline"));
    window.dispatchEvent(new Event("blur"));
    const text = uiLogSnapshot();
    expect(text).toContain("[ui.console] bad thing");
    expect(text).toContain("[ui.error] boom");
    expect(text).toContain("src=app.js:4:2");
    expect(text).toMatch(/WARN\s+\[ui\.network\] offline/);
    expect(text).toContain("[ui.window] blur");
  });
});
