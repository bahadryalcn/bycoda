// @vitest-environment happy-dom
import { afterEach, expect, it } from "vitest";
import { remoteShellState } from "./remoteShellState";

const shell = { id: "shell-1", cwd: "remote://machine/Users/me/project" };

afterEach(() => localStorage.clear());

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
