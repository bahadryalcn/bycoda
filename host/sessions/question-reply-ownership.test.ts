import { expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HostStore } from "../store";
import { resolveAuthorizedQuestionAttachments } from "./question-reply";

it("rechecks captured ownership after reading the actual uploaded UUID", async () => {
  const dir = await mkdtemp(join(tmpdir(), "question-resolution-"));
  const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  try {
    await writeFile(join(dir, id), "a");
    const authorize = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("revoked"));
    await expect(resolveAuthorizedQuestionAttachments(
      { attachmentDir: dir } as HostStore,
      [{ id: "q", prompt: "Question", multiSelect: false, allowCustom: true, options: [] }],
      { q: [{ id, name: "a.txt", mimeType: "text/plain", kind: "file", size: 1 }] },
      authorize,
    )).rejects.toThrow("revoked");
    expect(authorize).toHaveBeenCalledTimes(2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
