// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { InboxItem } from "../model/githubTasks";
import { useInboxDetailData } from "./useInboxDetailData";

const api = vi.hoisted(() => ({ details: vi.fn(), thread: vi.fn(), diff: vi.fn() }));
vi.mock("../model/githubTasks", () => ({
  GITHUB_WORK_ITEM_FRESH_MS: 300_000,
  githubWorkItemDetails: api.details,
  githubWorkItemThread: api.thread,
  githubPrDiff: api.diff,
  peekGithubWorkItemDetails: () => null,
  peekGithubWorkItemThread: () => null,
  peekGithubPrDiff: () => null,
}));
let root: Root;
let data: ReturnType<typeof useInboxDetailData>;
const base = {
  provider: "github",
  kind: "issue",
  repo: "org/repo",
  number: 1,
  projectPath: "/repo",
  title: "Issue",
  updatedAt: "v1",
} as InboxItem;
function Harness({ item, panel = false }: { item: InboxItem; panel?: boolean }) {
  data = useInboxDetailData(item, 0, "summary", false, panel);
  return null;
}
const render = async (item: InboxItem, panel = false) =>
  act(async () => root.render(createElement(Harness, { item, panel })));
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  api.details
    .mockReset()
    .mockImplementation(async () => ({ body: `details-${api.details.mock.calls.length}` }));
  api.thread
    .mockReset()
    .mockImplementation(async () => ({
      comments: [{ body: `thread-${api.thread.mock.calls.length}` }],
    }));
  api.diff.mockReset().mockResolvedValue({ files: [] });
  root = createRoot(document.createElement("div"));
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

it.each([false, true])(
  "refreshes details/thread for a changed list revision without a manual refresh (panel=%s)",
  async (panel) => {
    await render(base, panel);
    expect(data.details?.body).toBe("details-1");
    await render({ ...base, title: "Edited issue", updatedAt: "v2" }, panel);
    expect(api.details).toHaveBeenCalledTimes(2);
    expect(api.thread).toHaveBeenCalledTimes(2);
    expect(data.details?.body).toBe("details-2");
    expect(data.thread?.comments[0]?.body).toBe("thread-2");
    expect(api.details.mock.calls.at(-1)?.[4]).toEqual({ maxAgeMs: undefined });
  },
);

it("ignores an older in-flight detail response after a newer list revision", async () => {
  let release!: (value: { body: string }) => void;
  api.details.mockReturnValueOnce(
    new Promise((resolve) => {
      release = resolve;
    }),
  );
  await render(base);
  await render({ ...base, updatedAt: "v2" });
  expect(data.details?.body).toBe("details-2");
  await act(async () => release({ body: "stale details" }));
  expect(data.details?.body).toBe("details-2");
});
