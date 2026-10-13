import { EventEmitter } from "node:events";
import { afterEach, expect, it, vi } from "vitest";
import { RuntimeLogMonitors } from "./runtime-log-monitors";
import { RuntimeLogsService } from "./runtime-logs";
import type { BrowserLoader } from "./shared-browser";

const services: RuntimeLogMonitors[] = [];
afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.close()));
  vi.useRealTimers();
});
function fixture(fail = false) {
  const logs = new RuntimeLogsService();
  const pages: EventEmitter[] = [];
  const closed = vi.fn(async () => {});
  const load: BrowserLoader = vi.fn(async () => ({
    chromium: {
      launch: async () => ({
        close: closed,
        newContext: async () => ({
          newPage: async () => {
            let url = "about:blank";
            const page = Object.assign(new EventEmitter(), {
              goto: async (value: string) => {
                if (fail) throw new Error("Navigation failed");
                url = value;
              },
              url: () => url,
              screenshot: async () => Buffer.from(""),
              mouse: { click: async () => {}, wheel: async () => {} },
              keyboard: { type: async () => {}, press: async () => {} },
            });
            pages.push(page);
            return page;
          },
        }),
      }),
    },
  }));
  const monitors = new RuntimeLogMonitors(load, logs);
  services.push(monitors);
  return { monitors, logs, pages, load, closed };
}

it("starts only explicitly, captures simultaneous projects and stops only the requested monitor", async () => {
  const f = fixture();
  expect(f.load).not.toHaveBeenCalled();
  const first = await f.monitors.start("a", "3000");
  const second = await f.monitors.start("b", "http://localhost:5173");
  f.pages[0].emit("console", { text: () => "Project A", type: () => "info" });
  f.pages[1].emit("console", { text: () => "Project B", type: () => "error" });
  expect(f.logs.read({ projectId: "a" }).entries.map((entry) => entry.message)).toEqual([
    "Project A",
  ]);
  expect(f.logs.read({ projectId: "b" }).entries.map((entry) => entry.message)).toEqual([
    "Project B",
  ]);
  expect(f.logs.sources({ projectId: "a" })[0]).toMatchObject({
    id: first.sourceId,
    url: "http://localhost:3000/",
    label: "Log monitor · localhost:3000",
  });
  await expect(f.monitors.stop("b", first.id)).rejects.toThrow("this project");
  await f.monitors.stop("a", first.id);
  expect(f.monitors.list("a")).toEqual([]);
  expect(f.monitors.list("b")).toEqual([second]);
  expect(f.closed).toHaveBeenCalledOnce();
});

it("keeps monitors alive when the UI is idle and deduplicates the same URL in a project", async () => {
  vi.useFakeTimers();
  const f = fixture();
  const first = await f.monitors.start("a", "3000");
  expect(await f.monitors.start("a", "http://localhost:3000/")).toEqual(first);
  await vi.advanceTimersByTimeAsync(6 * 60_000);
  expect(f.closed).not.toHaveBeenCalled();
  expect(f.load).toHaveBeenCalledOnce();
});

it("validates targets, bounds concurrent launches, and releases capacity on failed navigation", async () => {
  const f = fixture();
  for (const value of ["0", "65536", "file:///secret", "http://user:secret@localhost", ""]) {
    await expect(f.monitors.start("a", value)).rejects.toThrow();
  }
  expect(f.load).not.toHaveBeenCalled();
  await Promise.all(
    Array.from({ length: 8 }, (_, index) => f.monitors.start("a", String(3000 + index))),
  );
  await expect(f.monitors.start("a", "4000")).rejects.toThrow("maximum 8");
  const failed = fixture(true);
  await expect(failed.monitors.start("a", "3000")).rejects.toThrow("Navigation failed");
  expect(failed.monitors.list("a")).toEqual([]);
  expect(failed.closed).toHaveBeenCalledOnce();
});
