import { expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostStore } from "../store";

it("drains actual disclosures before a canonical project retarget and rejects the old identity", async () => {
  const directory = mkdtempSync(join(tmpdir(), "project-identity-fence-"));
  const store = new HostStore(join(directory, "host.db"));
  try {
    const project = await store.addProject("/old", "Project");
    await expect(store.db.scope(() => store.withProjectIdentityWrite(async () => {}))).rejects.toThrow("before database ownership");
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    let sent = false, changed = false;
    const disclosure = store.withProjectIdentityRead([{ projectId: project.id, cwd: "/old" }], async valid => {
      entered(); await gate; expect(valid()).toBe(true); sent = true;
    });
    await started;
    const writer = store.withProjectIdentityWrite(async () => {
      await store.db.prepare("UPDATE projects SET cwd=? WHERE id=?").run("/new", project.id);
      changed = true;
    });
    const later = store.withProjectIdentityRead([{ projectId: project.id, cwd: "/old" }], async () => {});
    await Promise.resolve();
    expect(changed).toBe(false);
    release();
    await disclosure; await writer;
    expect(sent).toBe(true);
    expect(changed).toBe(true);
    await expect(later).rejects.toThrow("project identity changed");
    await expect(store.withProjectIdentityRead([{ projectId: project.id, cwd: "/new" }], async () => "new")).resolves.toBe("new");
  } finally { await store.close(); rmSync(directory, { recursive: true, force: true }); }
});
