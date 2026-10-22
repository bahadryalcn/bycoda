import { mkdir, writeFile, unlink } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { randomUUID } from "node:crypto";

import { MAX_REMOTE_ATTACHMENT_BYTES as MAX_BYTES } from "./attachments";
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export async function saveHostGeneratedImage(
  directory: string,
  input: { data: string; name: string },
) {
  if (input.data.length > 4 * Math.ceil(MAX_BYTES / 3) + 4)
    throw new Error("Generated image exceeds the remote attachment limit");
  const encoded = input.data.replace(/\s/g, "");
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length > MAX_BYTES)
    throw new Error("Generated image exceeds the remote attachment limit");
  if (bytes.toString("base64") !== encoded || !bytes.subarray(0, 8).equals(PNG))
    throw new Error("Generated image data is not a valid base64 PNG image");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, randomUUID());
  await writeFile(path, bytes, { flag: "wx", mode: 0o600 });
  const name = input.name.replace(/[^\p{L}\p{N}._-]/gu, "_").slice(0, 120) || "generated-image";
  return {
    path,
    name: name.endsWith(".png") ? name : `${name}.png`,
    mimeType: "image/png",
    size: bytes.length,
  };
}

export async function deleteHostGeneratedImages(directory: string, paths: string[]) {
  for (const path of paths) {
    if (
      dirname(resolve(path)) !== resolve(directory) ||
      !/^[0-9a-f-]{36}$/i.test(path.split(/[\\/]/).at(-1) ?? "")
    )
      throw new Error("Invalid generated image path");
    await unlink(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}
