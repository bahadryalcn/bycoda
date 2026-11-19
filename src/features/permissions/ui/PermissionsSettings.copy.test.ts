import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { SystemPermissionsReport } from "../../../platform/tauri/systemPermissions";
import { permissionInstructions } from "../model/permissions";
import { PermissionsSettings } from "./PermissionsSettings";

const { usePermissionStatus } = vi.hoisted(() => ({ usePermissionStatus: vi.fn() }));
vi.mock("../hooks/usePermissionStatus", () => ({ usePermissionStatus }));
vi.mock("./PermissionRow", () => ({ PermissionRow: () => null }));
vi.mock("../../../shared/lib/productIdentity", () => ({
  PRODUCT_IDENTITY: { displayName: "Permission Fixture Beta" },
}));
vi.mock("../model/permissions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../model/permissions")>()),
  linuxPermissionInstructions: () => "Shared Linux portal help fixture",
}));

function renderSettings(platform: SystemPermissionsReport["platform"], elevated = false) {
  usePermissionStatus.mockReturnValue({ report: { platform, elevated, entries: [] } });
  return renderToStaticMarkup(createElement(PermissionsSettings));
}

it("interpolates the build's product name into setup and elevation instructions", () => {
  expect(permissionInstructions("notifications", "macos")).toContain(
    "Notifications > Permission Fixture Beta.",
  );
  expect(permissionInstructions("microphone", "macos")).toContain(
    "Turn on Permission Fixture Beta.",
  );
  expect(permissionInstructions("notifications", "windows")).toContain(
    "Turn on Notifications and Permission Fixture Beta.",
  );
  expect(renderSettings("windows", true)).toContain("Permission Fixture Beta is running");
  expect(renderSettings("windows")).toContain("Permission Fixture Beta cannot control apps");
});

it("renders the shared Linux portal instructions in Settings", () => {
  expect(renderSettings("linux")).toContain("Shared Linux portal help fixture");
  expect(permissionInstructions("camera", "linux")).toContain("through your desktop portal");
});
