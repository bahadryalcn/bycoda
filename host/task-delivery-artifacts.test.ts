import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { transferTaskArtifacts } from "./task-artifacts";
import {
  previewTaskDeliveryArtifacts,
  validateTaskDeliveryArtifacts,
} from "./task-delivery-artifacts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "task-delivery-artifacts-"));
  roots.push(root);
  const repository = (name: string) => {
    const path = join(root, name);
    execFileSync("git", ["init", "-q", path], { windowsHide: true });
    writeFileSync(join(path, ".gitignore"), "/temp/\n");
    return path;
  };
  const source = repository("source");
  const target = repository("target");
  const output = (cwd: string, path: string, text = "approved output\n") => {
    const file = join(cwd, path);
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, text);
    return file;
  };
  const first = "temp/local/task/a.txt";
  const second = "temp/local/task/b.txt";
  return { root, source, target, output, first, second };
}

describe("task delivery artifact approval", () => {
  it("previews all ignored local outputs without copying files or including caches/tracked source", async () => {
    const r = fixture();
    r.output(r.source, r.second, "second\n");
    r.output(r.source, r.first);
    r.output(r.source, "temp/verification/check.log");
    r.output(r.source, "node_modules/cache.bin");
    r.output(r.source, "src/code.ts");
    const preview = await previewTaskDeliveryArtifacts(r.source, r.target);
    expect(preview.blockers).toEqual([]);
    expect(preview.paths).toEqual([r.first, r.second]);
    expect(Object.keys(preview.hashes)).toEqual([r.first, r.second]);
    expect(preview.targetHashes).toEqual({ [r.first]: null, [r.second]: null });
    expect(existsSync(join(r.target, "temp"))).toBe(false);
    await validateTaskDeliveryArtifacts(preview, r.source, r.target);
  });

  it.each(["changed", "added", "removed"])(
    "invalidates %s source output after approval",
    async (change) => {
      const r = fixture();
      r.output(r.source, r.first);
      const preview = await previewTaskDeliveryArtifacts(r.source, r.target);
      if (change === "changed") r.output(r.source, r.first, "new bytes\n");
      else if (change === "added") r.output(r.source, r.second);
      else rmSync(join(r.source, r.first));
      await expect(validateTaskDeliveryArtifacts(preview, r.source, r.target)).rejects.toThrow(
        "source changed",
      );
      expect(existsSync(join(r.target, "temp"))).toBe(false);
    },
  );

  it("binds empty source inventories so newly created output directories invalidate approval", async () => {
    const r = fixture();
    const preview = await previewTaskDeliveryArtifacts(r.source, r.target);
    expect(preview.paths).toEqual([]);
    expect(preview.blockers).toEqual([]);
    r.output(r.source, r.first);
    await expect(validateTaskDeliveryArtifacts(preview, r.source, r.target)).rejects.toThrow(
      "source changed",
    );
  });

  it("blocks destination collisions without changing either copy", async () => {
    const r = fixture();
    r.output(r.source, r.first);
    const destination = r.output(r.target, r.first, "owner bytes\n");
    const preview = await previewTaskDeliveryArtifacts(r.source, r.target);
    expect(preview.blockers.join(" ")).toContain("different content");
    await expect(
      validateTaskDeliveryArtifacts(preview, r.source, r.target, { allowCopied: true }),
    ).rejects.toThrow("different content");
    expect(readFileSync(destination, "utf8")).toBe("owner bytes\n");
  });

  it("rejects target drift before merge even when the new bytes match the approved source", async () => {
    const r = fixture();
    r.output(r.source, r.first);
    const preview = await previewTaskDeliveryArtifacts(r.source, r.target);
    r.output(r.target, r.first);
    await expect(validateTaskDeliveryArtifacts(preview, r.source, r.target)).rejects.toThrow(
      "target changed",
    );
    await validateTaskDeliveryArtifacts(preview, r.source, r.target, { allowCopied: true });
    r.output(r.target, r.first, "unapproved bytes\n");
    await expect(
      validateTaskDeliveryArtifacts(preview, r.source, r.target, { allowCopied: true }),
    ).rejects.toThrow("different content");
  });

  it("resumes a partially copied approved manifest and ignores unrelated target outputs", async () => {
    const r = fixture();
    r.output(r.source, r.first);
    r.output(r.source, r.second);
    r.output(r.target, r.second); // Already present at approval time.
    const preview = await previewTaskDeliveryArtifacts(r.source, r.target);
    r.output(r.target, "temp/local/other/owner.txt", "other session\n");
    await validateTaskDeliveryArtifacts(preview, r.source, r.target);
    await transferTaskArtifacts(r.source, r.target, [r.first], {
      [r.first]: preview.hashes[r.first],
    });
    await validateTaskDeliveryArtifacts(preview, r.source, r.target, { allowCopied: true });
    await transferTaskArtifacts(r.source, r.target, preview.paths, preview.hashes);
    await validateTaskDeliveryArtifacts(preview, r.source, r.target, { allowCopied: true });
    rmSync(join(r.target, r.second));
    await expect(
      validateTaskDeliveryArtifacts(preview, r.source, r.target, { allowCopied: true }),
    ).rejects.toThrow("beyond the approved copy");
  });

  it.each(["source", "target"])(
    "rejects %s directory junctions without following them",
    async (side) => {
      const r = fixture();
      r.output(r.source, r.first);
      const outside = join(r.root, "outside");
      mkdirSync(outside);
      writeFileSync(join(outside, "sentinel.txt"), "do not follow\n");
      if (side === "source") {
        symlinkSync(outside, join(r.source, "temp/local/linked"), "junction");
      } else {
        mkdirSync(join(r.target, "temp"));
        symlinkSync(outside, join(r.target, "temp/local"), "junction");
      }
      const preview = await previewTaskDeliveryArtifacts(r.source, r.target);
      expect(preview.blockers.join(" ")).toContain("symbolic links or junctions");
      expect(Object.keys(preview.hashes).some((path) => path.includes("sentinel"))).toBe(false);
      expect(readFileSync(join(outside, "sentinel.txt"), "utf8")).toBe("do not follow\n");
      expect(existsSync(join(outside, "task"))).toBe(false);
    },
  );

  it.each(["source", "target"])("rejects tracked or non-ignored %s outputs", async (side) => {
    const r = fixture();
    r.output(r.source, r.first);
    const checkout = side === "source" ? r.source : r.target;
    r.output(checkout, r.first);
    execFileSync("git", ["add", "-f", "--", r.first], { cwd: checkout, windowsHide: true });
    expect((await previewTaskDeliveryArtifacts(r.source, r.target)).blockers.join(" ")).toContain(
      "tracked files",
    );
    execFileSync("git", ["rm", "--cached", "-f", "--", r.first], {
      cwd: checkout,
      windowsHide: true,
    });
    writeFileSync(join(checkout, ".gitignore"), "");
    expect((await previewTaskDeliveryArtifacts(r.source, r.target)).blockers.join(" ")).toContain(
      "requires ignored",
    );
  });

  it("bounds source and destination hashing before reading oversized files", async () => {
    const r = fixture();
    const file = r.output(r.source, r.first);
    truncateSync(file, 16 * 1024 * 1024 + 1);
    expect((await previewTaskDeliveryArtifacts(r.source, r.target)).blockers.join(" ")).toContain(
      "size limit",
    );
    truncateSync(file, 5);
    const destination = r.output(r.target, r.first);
    truncateSync(destination, 16 * 1024 * 1024 + 1);
    expect((await previewTaskDeliveryArtifacts(r.source, r.target)).blockers.join(" ")).toContain(
      "size limit",
    );
  });

  it("rejects tampered approval manifests", async () => {
    const r = fixture();
    r.output(r.source, r.first);
    const preview = await previewTaskDeliveryArtifacts(r.source, r.target);
    preview.paths.push("temp/local/extra.txt");
    await expect(validateTaskDeliveryArtifacts(preview, r.source, r.target)).rejects.toThrow(
      "manifest is invalid",
    );
  });
});
