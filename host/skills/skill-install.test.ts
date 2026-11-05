import { afterEach, expect, it, vi } from "vitest";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
  symlink,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { installCatalogSkill, skillInstallStatus, runSkillInstallerCommand } from "./skill-install";
import type { RecommendedSkill } from "../../src/features/skills/model/recommendedSkills";
import {
  officialSkillNpmArgs,
  SKILLS_CLI_PACKAGE,
} from "../../src/features/skills/model/skillInstallRecipe";

const temporary: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const path of temporary.splice(0)) await rm(path, { recursive: true, force: true });
});
async function home() {
  // The installer reports canonical destinations; on Windows the temp directory
  // is an 8.3 short path (RUNNER~1) that realpath expands.
  const path = await realpath(await mkdtemp(join(tmpdir(), "bycoda-catalog-test-")));
  temporary.push(path);
  return path;
}
const entry: RecommendedSkill = {
  id: "test-skill",
  name: "test-skill",
  description: "Test",
  category: "development",
  repository: "https://github.com/test/skills",
  skillPath: "skills/test-skill",
  sourceUrl: "https://github.com/test/skills/tree/main/skills/test-skill",
  ref: "main",
};
const commit = "a".repeat(40);
const request = {
  requestId: "installation-request-0001",
  skillId: "test-skill",
  scope: "user",
  provider: "all",
  cwd: "",
};
const source = {
  "SKILL.md": "---\nname: test-skill\n---\n# Test",
  "references/help.md": "support file",
  "scripts/helper.sh": "#!/bin/sh\nexit 0",
};
function upstream(files: Record<string, string> = source) {
  const fetcher = vi.fn<typeof fetch>(async (input) => {
    expect(String(input)).toBe("https://api.github.com/repos/test/skills/commits/main");
    return Response.json({ sha: commit });
  });
  const command = vi.fn(
    async (
      _file: string,
      _args: string[],
      options: {
        cwd: string;
        env: NodeJS.ProcessEnv;
        windowsHide: true;
        shell: false;
        timeout: number;
        maxBuffer: number;
      },
    ) => {
      const output = join(options.cwd, ".agents/skills/test-skill");
      await mkdir(output, { recursive: true });
      for (const [path, body] of Object.entries(files)) {
        const target = join(output, path);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, body, { mode: path.endsWith(".sh") ? 0o755 : 0o644 });
      }
    },
  );
  return { fetch: fetcher, command, npmCliPath: "/test/npm-cli.js", catalog: [entry] };
}

it("runs pinned public installer without shell/global mode, publishes support files and verifies durable status", async () => {
  vi.stubEnv("GH_TOKEN", "private-gh-token");
  vi.stubEnv("NPM_TOKEN", "private-npm-token");
  vi.stubEnv("npm_config__authToken", "private-npm-auth");
  const root = await home();
  const dependencies = { home: root, ...upstream() };
  const result = await installCatalogSkill(request, dependencies);
  expect(result).toMatchObject({
    status: "installed",
    commit,
    path: join(root, ".agents/skills/test-skill/SKILL.md"),
  });
  expect(await readFile(join(root, ".agents/skills/test-skill/references/help.md"), "utf8")).toBe(
    "support file",
  );
  const [binary, args, options] = dependencies.command.mock.calls[0];
  expect(binary).toBe(process.execPath);
  expect(args).toEqual([dependencies.npmCliPath, ...officialSkillNpmArgs(entry, commit)]);
  expect(args).not.toContain("--global");
  expect(options).toMatchObject({
    windowsHide: true,
    shell: false,
    timeout: 180_000,
    maxBuffer: 1024 * 1024,
  });
  expect(options.cwd).not.toBe(root);
  expect(options.env.HOME).toBe(join(options.cwd, "home"));
  expect(options.env.USERPROFILE).toBe(options.env.HOME);
  expect(options.env.DISABLE_TELEMETRY).toBe("1");
  expect(options.env.npm_config_ignore_scripts).toBe("true");
  expect(options.env.GH_TOKEN).toBeUndefined();
  expect(options.env.NPM_TOKEN).toBeUndefined();
  expect(options.env.npm_config__authToken).toBeUndefined();
  await expect(stat(options.cwd)).rejects.toMatchObject({ code: "ENOENT" });
  const marker = JSON.parse(
    await readFile(join(root, ".agents/skills/test-skill/.bycoda-install.json"), "utf8"),
  );
  expect(marker).toMatchObject({
    schemaVersion: 1,
    provider: "all",
    requestId: request.requestId,
    repository: entry.repository,
    installer: SKILLS_CLI_PACKAGE,
    commit,
  });
  if (process.platform !== "win32")
    expect(
      (await stat(join(root, ".agents/skills/test-skill/scripts/helper.sh"))).mode & 0o777,
    ).toBe(0o755);
  expect((await skillInstallStatus(request, dependencies)).status).toBe("installed");
  expect((await installCatalogSkill(request, dependencies)).status).toBe("installed");
  expect(dependencies.command).toHaveBeenCalledOnce();
  expect(dependencies.fetch).toHaveBeenCalledOnce();
  expect(await readdir(join(root, ".agents/skills"))).toEqual(["test-skill"]);
});

it("keeps project/provider identity, refuses overwrite and refuses changed request identities", async () => {
  const root = await home();
  const project = join(root, "project");
  await mkdir(project);
  const selected = { ...request, scope: "project", cwd: project, provider: "codex" };
  const dependencies = { home: root, ...upstream() };
  expect(await installCatalogSkill(selected, dependencies)).toMatchObject({
    status: "installed",
    path: join(project, ".codex/skills/test-skill/SKILL.md"),
  });
  await expect(
    installCatalogSkill({ ...selected, provider: "claude" }, dependencies),
  ).rejects.toThrow("receipt");
  const again = await installCatalogSkill(
    { ...selected, requestId: "installation-request-0002" },
    dependencies,
  );
  expect(again.status).toBe("failed");
  expect(again.error).toContain("already exists");
  expect(dependencies.command).toHaveBeenCalledOnce();
});

it("preserves restrictions, never runs disabled skills and rechecks disablement after installer execution", async () => {
  const root = await home();
  await mkdir(join(root, ".bycoda-host"));
  const policy = join(root, ".bycoda-host/skill-policy.json");
  const disabled = JSON.stringify({ disabledNames: ["test-skill"], disabledPaths: [] });
  await writeFile(policy, disabled);
  const dependencies = { home: root, ...upstream() };
  await expect(installCatalogSkill(request, dependencies)).rejects.toThrow("disabled");
  expect(dependencies.fetch).not.toHaveBeenCalled();
  expect(dependencies.command).not.toHaveBeenCalled();
  expect(await readFile(policy, "utf8")).toBe(disabled);
  await writeFile(policy, JSON.stringify({ disabledNames: [], disabledPaths: [] }));
  const generate = dependencies.command.getMockImplementation()!;
  dependencies.command.mockImplementation(async (...args) => {
    await generate(...args);
    await writeFile(policy, disabled);
  });
  const result = await installCatalogSkill(request, dependencies);
  expect(result.status).toBe("failed");
  expect(result.error).toContain("disabled");
  expect(await readdir(join(root, ".agents/skills"))).toEqual([]);
});

it("rejects linked installer output and reserved paths without publishing", async () => {
  for (const mode of ["link", "reserved"] as const) {
    const root = await home();
    const dependencies = { home: root, ...upstream() };
    dependencies.command.mockImplementation(async (_file, _args, options) => {
      const output = join(options.cwd, ".agents/skills/test-skill");
      await mkdir(dirname(output), { recursive: true });
      if (mode === "link") await symlink(root, output, "junction");
      else {
        await mkdir(output);
        await writeFile(join(output, ".bycoda-install.json"), "reserved");
      }
    });
    expect((await installCatalogSkill(request, dependencies)).status).toBe("failed");
    expect(await readdir(join(root, ".agents/skills"))).toEqual([]);
  }
});

it("returns unknown after installed files change without rerunning public installer", async () => {
  const root = await home();
  const dependencies = { home: root, ...upstream() };
  expect((await installCatalogSkill(request, dependencies)).status).toBe("installed");
  await writeFile(join(root, ".agents/skills/test-skill/SKILL.md"), "owner edit");
  expect((await installCatalogSkill(request, dependencies)).status).toBe("unknown");
  expect(dependencies.command).toHaveBeenCalledOnce();
  expect(await readFile(join(root, ".agents/skills/test-skill/SKILL.md"), "utf8")).toBe(
    "owner edit",
  );
});

it("retains pending crash receipts and linked installation roots", async () => {
  const root = await home();
  const store = join(root, ".bycoda-host/skill-installs");
  await mkdir(store, { recursive: true });
  await writeFile(
    join(store, `${request.requestId}.json`),
    JSON.stringify({
      request,
      destination: join(root, ".agents/skills/test-skill"),
      result: { requestId: request.requestId, skillId: request.skillId, status: "pending" },
    }),
  );
  const dependencies = { home: root, ...upstream() };
  expect((await installCatalogSkill(request, dependencies)).status).toBe("unknown");
  expect(dependencies.command).not.toHaveBeenCalled();
  const separate = await home();
  const outside = await home();
  await symlink(outside, join(separate, ".agents"), "junction");
  await expect(installCatalogSkill(request, { ...dependencies, home: separate })).rejects.toThrow(
    "linked",
  );
  expect(await readdir(outside)).toEqual([]);
});

it("rejects arbitrary URLs and incomplete scope/provider selections before installer execution", async () => {
  const root = await home();
  const dependencies = { home: root, ...upstream() };
  await expect(
    installCatalogSkill({ ...request, skillId: "https://example.com/x" }, dependencies),
  ).rejects.toThrow("catalog");
  await expect(installCatalogSkill({ ...request, scope: "project" }, dependencies)).rejects.toThrow(
    "project folder",
  );
  await expect(
    installCatalogSkill({ ...request, provider: "unknown" }, dependencies),
  ).rejects.toThrow("provider");
  expect(dependencies.command).not.toHaveBeenCalled();
});

it("requires matching frontmatter and complete installer output", async () => {
  const cases: Record<string, string>[] = [
    { "SKILL.md": "# Missing metadata" },
    { "SKILL.md": "---\nname: renamed-skill\n---\n# Renamed" },
    { "help.md": "no skill" },
  ];
  for (const files of cases) {
    const root = await home();
    const result = await installCatalogSkill(request, { home: root, ...upstream(files) });
    expect(result.status).toBe("failed");
    expect(await readdir(join(root, ".agents/skills"))).toEqual([]);
  }
});

it("binds in-flight request identity and never starts second installer", async () => {
  const root = await home();
  const dependencies = { home: root, ...upstream() };
  const generate = dependencies.command.getMockImplementation()!;
  let release!: () => void;
  let started!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  dependencies.command.mockImplementation(async (...args) => {
    started();
    await waiting;
    await generate(...args);
  });
  const first = installCatalogSkill(request, dependencies);
  await ready;
  await expect(
    installCatalogSkill({ ...request, provider: "codex" }, dependencies),
  ).rejects.toThrow("receipt");
  expect(dependencies.command).toHaveBeenCalledOnce();
  release();
  expect((await first).status).toBe("installed");
});

it("bounds installer output and preserves failure recovery without publishing", async () => {
  const root = await home();
  const dependencies = {
    home: root,
    ...upstream({ "SKILL.md": source["SKILL.md"], "large.txt": "x".repeat(5 * 1024 * 1024) }),
  };
  const result = await installCatalogSkill(request, dependencies);
  expect(result.status).toBe("failed");
  expect(result.error).toContain("limit");
  expect(await readdir(join(root, ".agents/skills"))).toEqual([]);
});

it("reports official command failure and deadline without logging raw process output", async () => {
  for (const error of [
    { code: 7, killed: false, stderr: "sensitive output" },
    { code: 0, killed: true, stderr: "sensitive output" },
  ]) {
    const root = await home();
    const dependencies = { home: root, ...upstream() };
    dependencies.command.mockRejectedValue(error);
    const result = await installCatalogSkill(request, dependencies);
    expect(result.status).toBe("failed");
    expect(result.error).not.toContain("sensitive");
    expect(result.error).toContain(error.killed ? "deadline" : "code 7");
    expect(await readdir(join(root, ".agents/skills"))).toEqual([]);
  }
});

it("stops the owned npm process tree on deadline", async () => {
  const folder = await home();
  const script =
    "const {spawn}=require('node:child_process'); const {writeFileSync}=require('node:fs'); const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true}); writeFileSync('owned-child.pid',String(child.pid)); setInterval(()=>{},1000);";
  await expect(
    runSkillInstallerCommand(process.execPath, ["-e", script], {
      cwd: folder,
      env: process.env,
      windowsHide: true,
      shell: false,
      timeout: 750,
      maxBuffer: 1024,
    }),
  ).rejects.toMatchObject({ killed: true });
  const pid = Number(await readFile(join(folder, "owned-child.pid"), "utf8"));
  let stopped = false;
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      process.kill(pid, 0);
    } catch {
      stopped = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  expect(stopped).toBe(true);
});

it("bounds real installer process output", async () => {
  const folder = await home();
  await expect(
    runSkillInstallerCommand(
      process.execPath,
      ["-e", "process.stdout.write(Buffer.alloc(4096)); setInterval(()=>{},1000);"],
      {
        cwd: folder,
        env: process.env,
        windowsHide: true,
        shell: false,
        timeout: 3000,
        maxBuffer: 128,
      },
    ),
  ).rejects.toThrow("output exceeds");
});
