// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  QueryClient,
  QueryClientProvider,
  useInfiniteQuery,
  type InfiniteData,
} from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useFirstPageRefresh } from "./useFirstPageRefresh";

const INTERVAL = 1_000;
const SIZE = 2;

type Rows = { rows: string[]; next?: number };
type Data = InfiniteData<Rows, number>;

let element: HTMLDivElement, root: Root, cache: QueryClient;
let server: string[];
let reads: number[];
let state!: {
  data?: Data;
  hasNextPage: boolean;
  isError: boolean;
  fetchNextPage: () => Promise<unknown>;
};
let readFresh: () => Promise<Rows>;

function pageAt(offset: number): Rows {
  return {
    rows: server.slice(offset, offset + SIZE),
    ...(offset + SIZE < server.length ? { next: offset + SIZE } : {}),
  };
}
/** The fresh page replaces page one; the rest of the loaded pages stay. */
const merge = (data: Data, fresh: Rows): Data => ({
  ...data,
  pages: [fresh, ...data.pages.slice(1)],
});

function Probe({ id }: { id: string }) {
  const queryKey = ["list", id];
  state = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) => {
      reads.push(pageParam);
      return Promise.resolve(pageAt(pageParam));
    },
    initialPageParam: 0,
    getNextPageParam: (last) => last.next,
    staleTime: Infinity,
  });
  useFirstPageRefresh<Rows, number>({
    active: true,
    queryKey,
    intervalMs: INTERVAL,
    read: () => readFresh(),
    merge,
  });
  return null;
}
function render(id: string) {
  return act(async () => {
    root.render(createElement(QueryClientProvider, { client: cache }, createElement(Probe, { id })));
  });
}
function advance(ms: number) {
  return act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  element = document.createElement("div");
  document.body.append(element);
  root = createRoot(element);
  cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  server = ["a", "b", "c", "d", "e"];
  reads = [];
  readFresh = async () => pageAt(0);
});
afterEach(() => {
  act(() => root.unmount());
  element.remove();
  cache.clear();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("re-reads only the newest page on each poll, however many pages are loaded", async () => {
  await render("x");
  await advance(10);
  await act(async () => {
    await state.fetchNextPage();
  });
  expect(reads).toEqual([0, 2]);
  server = ["z", ...server];
  await advance(INTERVAL);
  // The query itself was not refetched: no extra page reads, and both loaded pages survive.
  expect(reads).toEqual([0, 2]);
  expect(state.data?.pages.map((page) => page.rows)).toEqual([
    ["z", "a"],
    ["c", "d"],
  ]);
  expect(state.hasNextPage).toBe(true);
});

it("does not repeat a list that was loaded less than half an interval ago", async () => {
  const read = vi.fn(async () => pageAt(0));
  readFresh = read;
  await render("x");
  await advance(900);
  await act(async () => {
    await state.fetchNextPage();
  });
  await advance(INTERVAL - 900 + 10);
  expect(read).not.toHaveBeenCalled();
  await advance(INTERVAL);
  expect(read).toHaveBeenCalledTimes(1);
});

it("drops a poll read that finishes after an explicit refetch, which wins", async () => {
  await render("x");
  await advance(10);
  let finish!: (page: Rows) => void;
  readFresh = () => new Promise<Rows>((resolve) => (finish = resolve));
  await advance(INTERVAL);
  server = ["n", ...server];
  await act(async () => {
    await cache.invalidateQueries({ queryKey: ["list", "x"] });
  });
  await act(async () => {
    finish({ rows: ["stale"] });
  });
  await advance(10);
  expect(state.data?.pages[0]?.rows).toEqual(["n", "a"]);
});

it("drops a poll read that finishes after the list key changed", async () => {
  await render("x");
  await advance(10);
  let finish!: (page: Rows) => void;
  readFresh = () => new Promise<Rows>((resolve) => (finish = resolve));
  await advance(INTERVAL);
  readFresh = async () => pageAt(0);
  await render("y");
  await advance(10);
  await act(async () => {
    finish({ rows: ["stale"] });
  });
  await advance(10);
  expect(cache.getQueryData<Data>(["list", "x"])?.pages[0]?.rows).toEqual(["a", "b"]);
  expect(cache.getQueryData<Data>(["list", "y"])?.pages[0]?.rows).toEqual(["a", "b"]);
});

it("keeps the loaded rows when a poll read fails", async () => {
  await render("x");
  await advance(10);
  readFresh = () => Promise.reject(new Error("Host offline"));
  await advance(INTERVAL);
  expect(state.data?.pages[0]?.rows).toEqual(["a", "b"]);
  expect(state.isError).toBe(false);
});
