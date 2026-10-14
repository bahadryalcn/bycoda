// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { OPEN_SESSION_IMPORT_EVENT, requestSessionImport } from "../import/importModel";
import { SessionImportHost } from "./SessionImportHost";

vi.mock("./SessionImportDialog", () => ({
  SessionImportDialog: ({
    initialContext,
  }: {
    initialContext?: { cwd: string; provider: string };
  }) =>
    createElement("div", {
      "data-import-cwd": initialContext?.cwd ?? "all",
      "data-import-provider": initialContext?.provider ?? "all",
    }),
}));

it("passes the command context to import and resets it for a Settings request", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(SessionImportHost, { onImported: vi.fn() })));
    await act(async () => requestSessionImport({ cwd: "/repo", provider: "codex" }));
    expect(container.querySelector("[data-import-cwd]")?.getAttribute("data-import-cwd")).toBe(
      "/repo",
    );
    expect(
      container.querySelector("[data-import-provider]")?.getAttribute("data-import-provider"),
    ).toBe("codex");
    await act(async () => window.dispatchEvent(new Event(OPEN_SESSION_IMPORT_EVENT)));
    expect(
      container.querySelector("[data-import-provider]")?.getAttribute("data-import-provider"),
    ).toBe("all");
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
