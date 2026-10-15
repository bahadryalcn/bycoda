import { afterEach, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { saveHostGeneratedImage, deleteHostGeneratedImages } from "./generated-images";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

it("persists a PNG on a headless host and confines cleanup to its artifact directory", async () => {
  const directory = await mkdtemp(join(tmpdir(), "host-image-"));
  directories.push(directory);
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6lX8AAAAASUVORK5CYII=",
    "base64",
  );
  const asset = await saveHostGeneratedImage(directory, {
    data: png.toString("base64"),
    name: "../image",
  });
  expect(await readFile(asset.path)).toEqual(png);
  expect(asset).toMatchObject({ mimeType: "image/png", size: png.length });
  expect(asset.name).not.toContain("/");
  await expect(
    deleteHostGeneratedImages(directory, [join(directory, "..", "outside")]),
  ).rejects.toThrow("Invalid generated image path");
  await deleteHostGeneratedImages(directory, [asset.path]);
  await expect(readFile(asset.path)).rejects.toMatchObject({ code: "ENOENT" });
});

it("rejects malformed base64 and non PNG data", async () => {
  await expect(
    saveHostGeneratedImage(tmpdir(), { data: "not base64!", name: "image" }),
  ).rejects.toThrow("valid base64 PNG");
  await expect(
    saveHostGeneratedImage(tmpdir(), {
      data: Buffer.from("text").toString("base64"),
      name: "image",
    }),
  ).rejects.toThrow("valid base64 PNG");
});
