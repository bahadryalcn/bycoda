// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { withMobileProjectLogos } from "./mobileProjectLogos";
import { notifyTabGroupLogosChanged, saveTabGroupLogo } from "../../workspace/model/tabGroups";
import type { DesktopProjectDirectory } from "../../connections/model/protocol";

beforeEach(() => {
  localStorage.clear();
  notifyTabGroupLogosChanged();
});
const directory = (): DesktopProjectDirectory => ({
  version: 1,
  projects: [{ cwd: "/visible", name: "Visible" }],
  groups: [],
  excludedPaths: ["/locked"],
  excludedGroupIds: [],
});
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

it("transfers only visible logos, caches them and updates/removes same-path replacements", async () => {
  saveTabGroupLogo("/visible", "/logos/one.png");
  saveTabGroupLogo("/locked", "/logos/private.png");
  const render = vi.fn().mockResolvedValue("data:image/png;base64,iVBORw0KGgoAAA==");
  expect(withMobileProjectLogos(directory(), render).projects[0].appearance).toBeUndefined();
  await flush();
  expect(withMobileProjectLogos(directory(), render).projects[0].appearance?.logo).toBeTruthy();
  expect(render).toHaveBeenCalledExactlyOnceWith("/logos/one.png");
  expect(JSON.stringify(withMobileProjectLogos(directory(), render))).not.toContain("/logos/");
  notifyTabGroupLogosChanged();
  render.mockResolvedValue("data:image/png;base64,iVBORw0KGgoBBB==");
  withMobileProjectLogos(directory(), render);
  await flush();
  expect(withMobileProjectLogos(directory(), render).projects[0].appearance?.logo).toContain(
    "BBB==",
  );
  saveTabGroupLogo("/visible", null);
  expect(withMobileProjectLogos(directory(), render).projects[0].appearance).toBeUndefined();
});

it("does not wait for or fail heartbeat projection when an image fails", async () => {
  saveTabGroupLogo("/visible", "/logos/broken.svg");
  const render = vi.fn().mockRejectedValue(new Error("Unreadable"));
  expect(withMobileProjectLogos(directory(), render).version).toBe(1);
  await flush();
  expect(withMobileProjectLogos(directory(), render).projects[0].appearance).toBeUndefined();
  expect(render).toHaveBeenCalledTimes(1);
});
