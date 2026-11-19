import { expect, it, vi } from "vitest";
import { createLinkWrapRegistry } from "./composerLinkWrap";

function link(log: string[], name: string, lines: number) {
  const element = {
    getClientRects: () => {
      log.push(`read:${name}`);
      return { length: lines };
    },
  } as unknown as HTMLElement;
  const apply = vi.fn((wrapped: boolean) => {
    log.push(`write:${name}:${wrapped}`);
  });
  return { element, apply };
}

it("reads every link before applying any result, so the links share one layout flush", () => {
  const log: string[] = [];
  const registry = createLinkWrapRegistry();
  const a = link(log, "a", 2);
  const b = link(log, "b", 1);
  const c = link(log, "c", 3);
  registry.add(a.element, a.apply);
  registry.add(b.element, b.apply);
  registry.add(c.element, c.apply);
  registry.measure();
  expect(log).toEqual([
    "read:a",
    "read:b",
    "read:c",
    "write:a:true",
    "write:b:false",
    "write:c:true",
  ]);
});

it("measures after a commit only when the draft changed or a link was added", () => {
  const log: string[] = [];
  const registry = createLinkWrapRegistry();
  const a = link(log, "a", 1);
  registry.add(a.element, a.apply);
  registry.settle("one");
  expect(a.apply).toHaveBeenCalledTimes(1);
  // A re-render over the same draft, such as a caret moving between links, reads nothing.
  registry.settle("one");
  expect(a.apply).toHaveBeenCalledTimes(1);
  registry.settle("two");
  expect(a.apply).toHaveBeenCalledTimes(2);
  const b = link(log, "b", 1);
  registry.add(b.element, b.apply);
  registry.settle("two");
  expect(a.apply).toHaveBeenCalledTimes(3);
  expect(b.apply).toHaveBeenCalledTimes(1);
});

it("stops measuring a link once it is untracked", () => {
  const log: string[] = [];
  const registry = createLinkWrapRegistry();
  const a = link(log, "a", 1);
  const b = link(log, "b", 1);
  const untrackA = registry.add(a.element, a.apply);
  registry.add(b.element, b.apply);
  untrackA();
  registry.measure();
  expect(log).toEqual(["read:b", "write:b:false"]);
});
