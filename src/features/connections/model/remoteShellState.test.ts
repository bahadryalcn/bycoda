// @vitest-environment happy-dom
import { afterEach, expect, it } from "vitest";
import {
  beginRemoteCreate,
  endRemoteCreate,
  resetRemoteCreateIntentsForTests,
} from "./remoteCreateIntent";
import { rememberRemoteProject, remotePath } from "./remoteProjects";
import { remoteShellState } from "./remoteShellState";

const shell = { id: "shell-1", cwd: "remote://machine/Users/me/project" };

afterEach(() => {
  localStorage.clear();
  resetRemoteCreateIntentsForTests();
});

it("keeps every remote shell while the tab bindings cannot be read", () => {
  expect(remoteShellState(shell).pending).toBe(true);
  localStorage.setItem("bycoda.remote-tabs.v2", "not json");
  expect(remoteShellState(shell).pending).toBe(true);
});

it("counts a saved host id or a live binding as bound", () => {
  localStorage.setItem("bycoda.remote-tabs.v2", JSON.stringify({ "shell-1": "host-1" }));
  expect(remoteShellState(shell).bound).toBe(true);
  localStorage.setItem("bycoda.remote-tabs.v2", "{}");
  expect(remoteShellState(shell, { bound: true }).bound).toBe(true);
  expect(remoteShellState(shell).bound).toBe(false);
});

it("keeps a shell pending while it creates its host session", () => {
  const cwd = remotePath("machine", "/Users/me/project");
  const project = rememberRemoteProject("machine", { id: "p1", cwd: "/Users/me/project" } as never);
  localStorage.setItem("bycoda.remote-tabs.v2", "{}");
  const creating = { id: "shell-1", cwd };
  expect(remoteShellState(creating).pending).toBe(false);
  const intent = beginRemoteCreate("shell-1", project.cwd, "machine", []);
  expect(remoteShellState(creating).pending).toBe(true);
  expect(remoteShellState({ id: "shell-2", cwd }).pending).toBe(false);
  endRemoteCreate("shell-1", intent);
  expect(remoteShellState(creating).pending).toBe(false);
});
