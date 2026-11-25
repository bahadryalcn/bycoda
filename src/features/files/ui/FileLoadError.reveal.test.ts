// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { revealPath } from "../../../platform/tauri/fs";
import { FileLoadError } from "./FileLoadError";
import { showErrorDetails } from "./errorDetails.test-support";

vi.mock("../../connections/public/remoteFailure", () => ({
  isUnsupportedRemoteRoute: () => false,
}));
vi.mock("../../../platform/tauri/platform", () => ({ IS_MAC: false, IS_WIN: true }));
vi.mock("../../../platform/tauri/fs", async (original) => ({
  ...(await original<typeof import("../../../platform/tauri/fs")>()),
  revealPath: vi.fn(),
}));

const LOCAL = "C:/project/notes.bin";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(revealPath).mockReset();
});

// A failed Reveal must stay visible in the view (translated headline, raw text behind Details).
it("shows a failed reveal inline instead of only logging it", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.mocked(revealPath).mockRejectedValueOnce(new Error("Explorer blocked"));
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(
      createElement(FileLoadError, { path: LOCAL, message: "Could not read", onRetry: vi.fn() }),
    ),
  );
  const reveal = [...host.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("Reveal"),
  )!;
  await act(async () => reveal.click());
  expect(revealPath).toHaveBeenCalledWith(LOCAL);
  expect(host.textContent).toContain("Couldn’t open the file location");
  await showErrorDetails(host);
  expect(document.body.textContent).toContain("Explorer blocked");
  await act(async () => root.unmount());
  host.remove();
});
