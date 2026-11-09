import { describe, expect, it, vi } from "vitest";

vi.mock("../../../platform/tauri/fs", () => ({ readTextFile: vi.fn(), statFiles: vi.fn() }));

import { projectActionCatalog } from "./projectActionCatalog";
import type { ProjectAction } from "./projectActions";
import type { ProjectActionPreset } from "./projectActionPresets";

const saved = (
  name: string,
  command: string,
  extra: Partial<ProjectAction> = {},
): ProjectAction => ({
  id: name,
  name,
  icon: "play",
  command,
  url: "",
  ...extra,
});
const preset = (name: string, command: string, devServer?: boolean): ProjectActionPreset => ({
  name,
  command,
  icon: "play",
  url: devServer ? "http://localhost:5173" : "",
  ...(devServer ? { devServer } : {}),
  source: "package.json",
});

describe("projectActionCatalog", () => {
  it("infers an unmarked saved dev script as the local server", () => {
    // The owner's top-bar "dev · pnpm run dev" has no "Manage as development server" flag.
    const catalog = projectActionCatalog(
      [saved("dev", "pnpm run dev")],
      [preset("dev", "pnpm run dev", true), preset("build", "pnpm run build")],
    );
    expect(catalog.localServer).toMatchObject({
      name: "dev",
      command: "pnpm run dev",
      devServer: true,
      source: "saved",
    });
    // The detected duplicate is folded into the saved action.
    expect(catalog.actions.map((action) => [action.source, action.name])).toEqual([
      ["saved", "dev"],
      ["package.json", "build"],
    ]);
  });

  it("prefers the owner's explicitly marked server and keeps its port", () => {
    const catalog = projectActionCatalog(
      [
        saved("start", "pnpm start"),
        saved("Portal", "node scripts/serve.mjs", {
          devServer: true,
          url: "http://localhost:4300",
        }),
      ],
      [],
    );
    expect(catalog.localServer).toMatchObject({ name: "Portal", expectedPort: 4300 });
  });

  it("falls back to detected scripts and reports no server when none exists", () => {
    expect(
      projectActionCatalog([], [preset("dev", "pnpm run dev", true)]).localServer,
    ).toMatchObject({ source: "package.json", expectedPort: 5173 });
    const none = projectActionCatalog([saved("lint", "pnpm lint")], [preset("test", "pnpm test")]);
    expect(none.localServer).toBeUndefined();
    expect(none.actions.every((action) => !action.devServer)).toBe(true);
  });
});
