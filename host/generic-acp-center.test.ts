import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { GenericAcpService } from "./generic-acp";
const config = { id: "fixture", name: "Fixture agent", command: "fixture-command-token", args: ["--token", "fixture-arg-secret"],
  env: { PRIVATE_FIXTURE_KEY: "fixture-env-secret" }, authMethodId: "fixture-auth-secret", contextWindow: 64000 };
it("projects only bounded safe metadata and preserves all launch/auth fields on guarded metadata update", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bycoda-acp-center-"));
  try {
    const service = new GenericAcpService(dir); await service.save(config);
    const center = await service.center();
    expect(center.agents).toEqual([{ id: "fixture", name: "Fixture agent", argumentCount: 2, environmentKeyCount: 1, contextWindow: 64000 }]);
    expect(center.revision).toMatch(/^[a-f0-9]{64}$/);
    for (const secret of [config.command, config.args[1], "PRIVATE_FIXTURE_KEY", config.env.PRIVATE_FIXTURE_KEY, config.authMethodId]) expect(JSON.stringify(center)).not.toContain(secret);
    await service.patchMetadata({ id: "fixture", expectedRevision: center.revision, name: "Renamed", contextWindow: null });
    expect(await service.get("fixture")).toEqual({ ...config, name: "Renamed", contextWindow: undefined });
    expect((await service.center()).revision).not.toBe(center.revision);
    await expect(service.patchMetadata({ id: "fixture", expectedRevision: center.revision, name: "Stale" })).rejects.toThrow("changed");
    expect((await service.get("fixture")).name).toBe("Renamed");
  } finally { await rm(dir, { recursive: true, force: true }); }
});
it("shares a canonical-directory queue across instances and directory aliases", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bycoda-acp-alias-"));
  try {
    const real = join(dir, "real"); const alias = join(dir, "alias"); await mkdir(real);
    await symlink(real, alias, process.platform === "win32" ? "junction" : "dir");
    const first = new GenericAcpService(real); const second = new GenericAcpService(alias);
    await Promise.all(Array.from({ length: 12 }, (_, at) => (at % 2 ? first : second).save({ ...config, id: `fixture-${at}` })));
    expect((await first.center()).agents).toHaveLength(12);
    const { revision } = await first.center();
    const updates = await Promise.allSettled([first.patchMetadata({ id: "fixture-0", expectedRevision: revision, name: "First" }), second.patchMetadata({ id: "fixture-1", expectedRevision: revision, name: "Second" })]);
    expect(updates.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(updates.filter((item) => item.status === "rejected")).toHaveLength(1);
    expect((await first.center()).agents).toHaveLength(12);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
it("rejects launch/secret edits and malformed or oversized stores with sanitized errors", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bycoda-acp-bounds-"));
  try {
    const service = new GenericAcpService(dir); await service.save(config);
    const { revision } = await service.center();
    await expect(service.patchMetadata({ id: "fixture", expectedRevision: revision, name: "No", command: "unexpected" } as Parameters<typeof service.patchMetadata>[0])).rejects.toThrow("Invalid ACP metadata");
    expect(JSON.parse(await readFile(join(dir, "generic-acp.json"), "utf8"))[0].command).toBe(config.command);
    await writeFile(join(dir, "generic-acp.json"), '{"PRIVATE_FIXTURE_SECRET":"invalid');
    await expect(service.center()).rejects.toThrow(/^ACP configuration could not be read$/);
    await writeFile(join(dir, "generic-acp.json"), "x".repeat(1024 * 1024 + 1));
    await expect(service.center()).rejects.toThrow(/^ACP configuration could not be read$/);
    await writeFile(join(dir, "generic-acp.json"), JSON.stringify(Array.from({ length: 257 }, (_, at) => ({ ...config, id: `fixture-${at}` }))));
    await expect(service.center()).rejects.toThrow(/^ACP configuration could not be read$/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
