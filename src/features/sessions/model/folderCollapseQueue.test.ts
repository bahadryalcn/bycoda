import { afterEach, expect, test, vi } from "vitest";
import { createFolderCollapseQueue, type FolderCollapseChange } from "./folderCollapseQueue";
import type { SessionFolder } from "./sessionFolders";

const folder = (id: string, collapsed = false) =>
  ({ id, name: id, sessionIds: [], collapsed }) as unknown as SessionFolder;

afterEach(() => vi.useRealTimers());

test("shows clicks at once and saves only the latest state per folder", async () => {
  const sent: FolderCollapseChange[][] = [];
  let release!: () => void;
  const persist = vi.fn(async (changes: FolderCollapseChange[]) => {
    sent.push(changes);
    if (sent.length === 1) await new Promise<void>((resolve) => (release = resolve));
    return "applied" as const;
  });
  const queue = createFolderCollapseQueue({ persist, onFailed: vi.fn() });

  queue.toggle("a", true);
  expect(queue.overlay([folder("a")])[0].collapsed).toBe(true);
  queue.toggle("a", false);
  queue.toggle("a", true);
  expect(queue.overlay([folder("a")])[0].collapsed).toBe(true);

  release();
  await vi.waitFor(() => expect(sent).toHaveLength(2));
  expect(sent).toEqual([
    [{ folderId: "a", collapsed: true }],
    [{ folderId: "a", collapsed: true }],
  ]);
});

test("retries while another change runs and drops the overlay after a failure", async () => {
  vi.useFakeTimers();
  const onFailed = vi.fn();
  const results = ["retry", "failed"] as const;
  const persist = vi.fn(async () => results[persist.mock.calls.length - 1]);
  const queue = createFolderCollapseQueue({ persist, onFailed });

  queue.toggle("a", true);
  await vi.advanceTimersByTimeAsync(0);
  expect(queue.overlay([folder("a")])[0].collapsed).toBe(true);
  await vi.advanceTimersByTimeAsync(200);
  expect(persist).toHaveBeenCalledTimes(2);
  expect(onFailed).toHaveBeenCalledOnce();
  expect(queue.overlay([folder("a")])[0].collapsed).toBe(false);
});
