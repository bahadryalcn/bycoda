import { expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostStore } from "../store";
import { AttachmentOwnership } from "./attachment-ownership";
import { writeAttachmentChunk } from "./attachments";

it("binds the uploaded UUID to the original principal and question occurrence", async () => {
  const dir = mkdtempSync(join(tmpdir(), "question-ownership-"));
  const store = new HostStore(join(dir, "host.db"));
  const ownership = new AttachmentOwnership(store);
  const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  try {
    await ownership.bindQuestion("principal", id, "session", "run", 1, "occurrence");
    await writeAttachmentChunk(store, { id, offset: 0, size: 1, data: "YQ==" });
    await ownership.assertQuestion("principal", [id], "session", "run", 1, "occurrence");
    await expect(
      ownership.assertQuestion("other", [id], "session", "run", 1, "occurrence"),
    ).rejects.toThrow();
    await expect(
      ownership.assertQuestion("principal", [id], "other", "run", 1, "occurrence"),
    ).rejects.toThrow();
    await expect(
      ownership.assertQuestion("principal", [id], "session", "run", 1, "new-occurrence"),
    ).rejects.toThrow();
    await expect(
      ownership.bindQuestion("other", id, "session", "run", 1, "occurrence"),
    ).rejects.toThrow();
  } finally {
    await ownership.close();
    await store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
