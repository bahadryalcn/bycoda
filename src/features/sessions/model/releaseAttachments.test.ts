import { expect, it, vi } from "vitest";
import type { Attachment } from "./session";
const revoke = vi.hoisted(() => vi.fn());
vi.mock("./attachments", () => ({ revokeAttachment: revoke }));
import { releaseAttachments } from "./releaseAttachments";

it("ödünç ve tutulan önizlemeleri korur, yalnız sahip olunanları bırakır", () => {
  const owned = { id: "owned" } as Attachment;
  const borrowed = { id: "borrowed" } as Attachment;
  const retained = { id: "retained" } as Attachment;
  const borrowedIds = new Set(["borrowed", "retained"]);
  releaseAttachments([owned, borrowed, retained], borrowedIds, new Set(["retained"]));
  expect(revoke).toHaveBeenCalledExactlyOnceWith(owned);
  expect(borrowedIds).toEqual(new Set(["retained"]));
});
