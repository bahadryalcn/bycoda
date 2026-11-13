// @vitest-environment happy-dom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { SystemPermissionsReport } from "../../../platform/tauri/systemPermissions";

const state = vi.hoisted(() => ({ report: undefined as SystemPermissionsReport | undefined }));
vi.mock("../hooks/usePermissionStatus", () => ({
  usePermissionStatus: () => ({ report: state.report, entries: [], loading: false, failed: false }),
}));
vi.mock("./PermissionRow", () => ({
  PermissionRow: ({ id }: { id: string }) => createElement("div", { "data-row": id }),
}));
import { PermissionsSettings } from "./PermissionsSettings";

const entry = (id: string, value: string) => ({
  id,
  state: value,
  canRequest: false,
  canOpenSettings: value !== "not-required",
});

it("collapses capabilities the OS does not gate into one line", () => {
  state.report = {
    version: 1,
    platform: "windows",
    signing: "unknown",
    elevated: false,
    entries: [
      entry("microphone", "granted"),
      entry("camera", "denied"),
      entry("screen-recording", "not-required"),
      entry("accessibility", "not-required"),
      entry("notifications", "granted"),
      entry("full-disk-access", "not-required"),
    ],
  } as SystemPermissionsReport;
  const html = renderToStaticMarkup(createElement(PermissionsSettings));
  for (const id of ["microphone", "camera", "notifications"])
    expect(html).toContain(`data-row="${id}"`);
  for (const id of ["screen-recording", "accessibility", "full-disk-access"])
    expect(html).not.toContain(`data-row="${id}"`);
  expect(html).toContain(
    "This system does not ask for these permissions: Screen recording, Accessibility, Full Disk Access",
  );
});

it("keeps every row until the first status read arrives", () => {
  state.report = undefined;
  const html = renderToStaticMarkup(createElement(PermissionsSettings));
  expect(html.match(/data-row=/g)).toHaveLength(6);
  expect(html).not.toContain("This system does not ask");
});
