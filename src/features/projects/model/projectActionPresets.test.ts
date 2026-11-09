import { describe, expect, it } from "vitest";
import { detectProjectActionPresets } from "./projectActionPresets";

function io(files: Record<string, string>) {
  return {
    read: async (path: string) => {
      const name = path.split("/").pop()!;
      if (!(name in files)) throw new Error("missing");
      return files[name];
    },
    exists: async (paths: string[]) => paths.map((path) => path.split("/").pop()! in files),
  };
}

describe("detectProjectActionPresets", () => {
  it("ranks package.json scripts and uses the lockfile's package manager", async () => {
    const presets = await detectProjectActionPresets(
      "C:/app",
      io({
        "package.json": JSON.stringify({
          scripts: {
            lint: "eslint .",
            build: "vite build",
            pretest: "node prep.js",
            test: "vitest",
            dev: "vite --port 5300",
            start: "next start",
            postinstall: "patch-package",
          },
        }),
        "pnpm-lock.yaml": "",
      }),
    );
    expect(presets.map((preset) => preset.name)).toEqual([
      "dev",
      "start",
      "test",
      "build",
      "lint",
      "postinstall",
    ]);
    expect(presets[0]).toMatchObject({
      command: "pnpm run dev",
      icon: "play",
      url: "http://localhost:5300",
      devServer: true,
    });
    expect(presets[1].url).toBe("http://localhost:3000");
    expect(presets[3]).toMatchObject({ icon: "wrench", url: "" });
    expect(presets[0].source).toBe("package.json");
  });

  it("prefers the packageManager field and keeps npm test short", async () => {
    const declared = await detectProjectActionPresets(
      "/app",
      io({
        "package.json": JSON.stringify({
          packageManager: "bun@1.1.0",
          scripts: { test: "x" },
        }),
        "yarn.lock": "",
      }),
    );
    expect(declared[0].command).toBe("bun run test");
    const npm = await detectProjectActionPresets(
      "/app",
      io({
        "package.json": JSON.stringify({
          scripts: { test: "x", "build:web": "y" },
        }),
      }),
    );
    expect(npm.map((preset) => preset.command)).toEqual(["npm test", "npm run build:web"]);
  });

  it("falls back to Cargo and returns nothing for unknown or invalid folders", async () => {
    const cargo = await detectProjectActionPresets(
      "/crate",
      io({ "package.json": "{not json", "Cargo.toml": "[package]" }),
    );
    expect(cargo.map((preset) => preset.command)).toEqual([
      "cargo run",
      "cargo test",
      "cargo build",
    ]);
    expect(await detectProjectActionPresets("/empty", io({}))).toEqual([]);
  });
});
