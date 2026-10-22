// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { AttachmentOwnership } from "./attachmentOwnership";
import {
  desktopAttachmentInventory,
  globalDesktopAttachmentInventory,
} from "./desktopAttachmentInventory";
import { savePendingRemoteCommand } from "./remoteOutbox";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});
const scope = () =>
  new AttachmentOwnership(
    JSON.stringify(["composer", "shell", "main"]),
    "inventory",
    async () => {},
  );
it("requires strict native draft and queue absence in one read-only inventory", async () => {
  vi.mocked(invoke).mockResolvedValue({ draftIds: ["draft"], queues: { queue: ["queued"] } });
  expect(
    await desktopAttachmentInventory(scope(), "machine", "host", "shell", "project", "queue"),
  ).toEqual({ draft: ["draft"], pending: [], "queue:queue": ["queued"] });
  expect(invoke).toHaveBeenCalledWith("session_attachment_references", {
    sessionId: "shell",
    queueSessionIds: ["queue"],
  });
  expect(invoke).toHaveBeenCalledTimes(1);
});
it.each([
  { draftIds: null, queues: { queue: [] } },
  { draftIds: [42], queues: { queue: [] } },
  { draftIds: [], queues: {} },
  { draftIds: [], queues: { queue: null } },
  { draftIds: [], queues: { queue: [{ id: "lossy" }] } },
])("never treats malformed native references as absent: %j", async (value) => {
  vi.mocked(invoke).mockResolvedValue(value);
  await expect(
    desktopAttachmentInventory(scope(), "machine", "host", "shell", "project", "queue"),
  ).rejects.toThrow();
});
it.each(["Invalid saved draft JSON", "Invalid saved queue row"])(
  "preserves claims when strict native storage rejects: %s",
  async (message) => {
    vi.mocked(invoke).mockRejectedValue(new Error(message));
    const held = scope();
    await held.acquire("draft", ["file"]);
    await expect(
      desktopAttachmentInventory(held, "machine", "host", "shell", "project", "queue"),
    ).rejects.toThrow(message);
  },
);
it("combines global strict native references with pending requests from every project of the same host", async () => {
  vi.mocked(invoke).mockResolvedValue({
    draftIds: ["saved-draft"],
    queues: { any: ["saved-queue"] },
  });
  const file = {
    id: "pending-other-project",
    name: "a",
    kind: "file" as const,
    mimeType: "text/plain",
    size: 1,
  };
  savePendingRemoteCommand(
    "other-project",
    "host",
    {
      type: "send",
      commandId: "global-pending",
      sessionId: "other-session",
      text: "waiting",
      attachments: [file],
    },
    "other-shell",
  );
  const sources = await globalDesktopAttachmentInventory("current-shell", "host");
  expect(sources.draft).toContain("saved-draft");
  expect(sources.queues).toEqual(["saved-queue"]);
  expect(sources.pending).toEqual(["pending-other-project"]);
  expect(invoke).toHaveBeenCalledWith("session_attachment_references", {
    sessionId: "current-shell",
    queueSessionIds: [],
    allSessions: true,
  });
});
