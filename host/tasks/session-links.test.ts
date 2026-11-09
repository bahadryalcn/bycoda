import { afterEach, expect, it } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionTaskLinkError, SessionTaskLinks } from "./session-links";

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});
async function fixture(tasks = new Set(["t1", "t2"])) {
  const dir = await mkdtemp(join(tmpdir(), "links-"));
  dirs.push(dir);
  const make = () =>
    new SessionTaskLinks(dir, {
      taskExists: async (id) => tasks.has(id),
      now: () => 7,
    });
  return { dir, make, links: make(), tasks };
}

it("links many sessions to one task and reads both directions", async () => {
  const { links } = await fixture();
  await links.link("s1", "t1");
  await links.link("s2", "t1");
  expect(await links.taskFor("s1")).toBe("t1");
  expect((await links.sessionsFor("t1")).sort()).toEqual(["s1", "s2"]);
});

it("allows at most one task per session", async () => {
  const { links } = await fixture();
  await links.link("s1", "t1");
  await expect(links.link("s1", "t2")).rejects.toMatchObject({
    code: "already-linked",
  });
  expect(await links.link("s1", "t1")).toMatchObject({ taskId: "t1" });
  expect(await links.taskFor("s1")).toBe("t1");
});

it("refuses unknown tasks and bad ids without writing", async () => {
  const { links } = await fixture();
  await expect(links.link("s1", "nope")).rejects.toBeInstanceOf(SessionTaskLinkError);
  await expect(links.link("", "t1")).rejects.toMatchObject({
    code: "invalid-id",
  });
  expect(await links.taskFor("s1")).toBeUndefined();
});

it("unlinks and allows relinking elsewhere", async () => {
  const { links } = await fixture();
  await links.link("s1", "t1");
  expect(await links.unlink("s1")).toBe(true);
  expect(await links.unlink("s1")).toBe(false);
  await links.link("s1", "t2");
  expect(await links.taskFor("s1")).toBe("t2");
});

it("keeps links after a Host restart", async () => {
  const { links, make } = await fixture();
  await links.link("s1", "t1");
  expect(await make().taskFor("s1")).toBe("t1");
});

it("keeps the first row when a file names two tasks for one session", async () => {
  const { dir, make } = await fixture();
  await mkdir(join(dir, "tasks"), { recursive: true });
  await writeFile(
    join(dir, "tasks", "session-links.json"),
    JSON.stringify([
      { sessionId: "s1", taskId: "t1", linkedAt: 1 },
      { sessionId: "s1", taskId: "t2", linkedAt: 2 },
    ]),
  );
  expect(await make().taskFor("s1")).toBe("t1");
});

it("prunes links of deleted sessions or tasks", async () => {
  const { links } = await fixture();
  await links.link("s1", "t1");
  await links.link("s2", "t2");
  expect(
    await links.prune(
      (id) => id !== "s1",
      () => true,
    ),
  ).toBe(1);
  expect(await links.taskFor("s1")).toBeUndefined();
  expect(await links.taskFor("s2")).toBe("t2");
});
