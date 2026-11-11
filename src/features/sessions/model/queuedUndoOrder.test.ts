import { describe, expect, it } from "vitest";
import { createQueuedUndoOrder } from "./queuedUndoOrder";
import { restoreQueuedMessage } from "./messageQueue";
import type { QueuedMessage } from "./session";

const message = (id: string): QueuedMessage => ({ id, text: id, attachments: [] });

describe("queue undo ordering", () => {
  it.each(["chronological", "reverse"] as const)(
    "preserves multiple removed anchors in %s undo order",
    (direction) => {
      const context = createQueuedUndoOrder();
      let rows = ["a", "b", "c"].map(message);
      const receipts = ["a", "b", "c"].map((id) => {
        const receipt = context.capture(
          rows.map((row) => row.id),
          id,
          `${id}-new`,
        );
        rows = rows.filter((row) => row.id !== id);
        return { id, ...receipt };
      });
      if (direction === "reverse") receipts.reverse();
      for (const receipt of receipts) {
        rows = restoreQueuedMessage(rows, message(`${receipt.id}-new`), receipt.ids(), receipt.id);
        receipt.dispose();
      }
      expect(rows.map((row) => row.id)).toEqual(["a-new", "b-new", "c-new"]);
    },
  );

  it("keeps concurrent additions and maps anchors to fresh restored identities", () => {
    const context = createQueuedUndoOrder();
    const a = context.capture(["a", "b", "c"], "a", "a-new");
    const b = context.capture(["x", "b", "c", "y"], "b", "b-new");
    expect(a.ids()).toEqual(["x", "a", "b-new", "c", "y"]);
    expect(b.ids()).toEqual(["x", "a-new", "b", "c", "y"]);
    a.dispose();
    b.dispose();
    const fresh = context.capture(["z", "a-new"], "a-new", "a-again");
    expect(fresh.ids()).toEqual(["z", "a-new"]);
  });
});
