// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import {
  beginRemoteCreate,
  endRemoteCreate,
  resetRemoteCreateIntentsForTests,
} from "./remoteCreateIntent";
import { rememberRemoteProject, remotePath } from "./remoteProjects";
import { remoteShellState } from "./remoteShellState";
const outbox = vi.hoisted(() => ({ unavailable: false }));
vi.mock("./remoteOutbox", () => ({
  readDurableRemoteCommand: async () => {
    if (outbox.unavailable) throw new Error("storage unavailable");
    return { revision: 0 };
  },
}));

const shell = { id: "shell-1", cwd: "remote://machine/Users/me/project" };

afterEach(() => {
  localStorage.clear();
  resetRemoteCreateIntentsForTests();
  outbox.unavailable = false;
});

it("keeps every remote shell while the tab bindings cannot be read", async () => {
  expect((await remoteShellState(shell)).pending).toBe(true);
  localStorage.setItem("bycoda.remote-tabs.v2", "not json");
  expect((await remoteShellState(shell)).pending).toBe(true);
});

it("counts a saved host id or a live binding as bound", async () => {
  localStorage.setItem("bycoda.remote-tabs.v2", JSON.stringify({ "shell-1": "host-1" }));
  expect((await remoteShellState(shell)).bound).toBe(true);
  localStorage.setItem("bycoda.remote-tabs.v2", "{}");
  expect((await remoteShellState(shell, { bound: true })).bound).toBe(true);
  expect((await remoteShellState(shell)).bound).toBe(false);
});

it("keeps a shell pending while it creates its host session", async () => {
  const cwd = remotePath("machine", "/Users/me/project");
  const project = rememberRemoteProject("machine", { id: "p1", cwd: "/Users/me/project" } as never);
  localStorage.setItem("bycoda.remote-tabs.v2", "{}");
  const creating = { id: "shell-1", cwd };
  expect((await remoteShellState(creating)).pending).toBe(false);
  outbox.unavailable = true;
  expect((await remoteShellState(creating)).pending).toBe(true);
  outbox.unavailable = false;
  const intent = beginRemoteCreate("shell-1", project.cwd, "machine", []);
  expect((await remoteShellState(creating)).pending).toBe(true);
  expect((await remoteShellState({ id: "shell-2", cwd })).pending).toBe(false);
  endRemoteCreate("shell-1", intent);
  expect((await remoteShellState(creating)).pending).toBe(false);
});
