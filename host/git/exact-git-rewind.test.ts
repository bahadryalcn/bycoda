import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createExactGitRewindPolicy } from "./exact-git-rewind";

it("defaults OFF and persists an explicit Host opt-in across instances", async () => {
  const root = await mkdtemp(join(tmpdir(), "exact-git-rewind-"));
  try {
    const policy = createExactGitRewindPolicy(join(root, "nested"));
    expect(await policy.enabled()).toBe(false);
    await policy.save(false);
    await writeFile(join(root, "nested", "exact-git-rewind.json"), "invalid");
    expect(await policy.enabled()).toBe(false);
    await expect(policy.read()).rejects.toThrow();
    await policy.save(true);
    expect(await createExactGitRewindPolicy(join(root, "nested")).enabled()).toBe(true);
    await policy.save(false);
    expect(await policy.enabled()).toBe(false);
    await expect(policy.save("true" as unknown as boolean)).rejects.toThrow(/boolean/);
    expect(await policy.enabled()).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
