// @vitest-environment happy-dom
import { convertFileSrc } from "@tauri-apps/api/core";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { projectKey } from "../../../shared/lib/paths";
import { saveTabGroupLogo } from "../../workspace/model/tabGroups";
import { rowCopy } from "./searchRowCopy";

vi.mock("@tauri-apps/api/core", async (original) => ({
  ...(await original<typeof import("@tauri-apps/api/core")>()),
  convertFileSrc: vi.fn((path: string) => `asset://${path}`),
  invoke: vi.fn(async () => null),
}));

const localPath = "C:/workspace/project";
const remotePath = "remote://machine/home/project";
const icon = (path: string) =>
  rowCopy({ id: path, kind: "project", name: "project", path, score: 1, positions: [] }, "", {})
    .icon;

it("loads only a configured logo and uses a folder for project directory paths", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const root = createRoot(container);
  const logo = "C:/AppData/bycoda/project-logos/custom.png";
  try {
    await act(async () => root.render(icon(localPath)));
    expect(container.querySelector("img")).toBeNull();
    await act(async () => root.render(icon(remotePath)));
    expect(container.querySelector("img")).toBeNull();
    expect(convertFileSrc).not.toHaveBeenCalled();

    saveTabGroupLogo(projectKey(localPath), logo);
    await act(async () => root.render(icon(localPath)));
    expect(convertFileSrc).toHaveBeenCalledWith(logo);
    expect(container.querySelector("img")?.getAttribute("src")).toContain("custom.png");
  } finally {
    await act(async () => root.unmount());
    localStorage.clear();
    vi.unstubAllGlobals();
  }
});
