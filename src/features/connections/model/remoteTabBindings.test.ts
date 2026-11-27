// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import {
  REMOTE_HISTORY_CHANGE,
  REMOTE_TAB_BINDING_CHANGE,
  refreshRemoteProjectSessions,
  rememberRemoteSession,
  remoteSessionFor,
  remoteShellBoundTo,
} from "./connections";

afterEach(() => localStorage.clear());

it("decodes unchanged tab bindings once and sees direct replacements and removal immediately", () => {
  const key = "bycoda.remote-tabs.v2";
  const raw = '{"shell":"host-before"}';
  localStorage.setItem(key, raw);
  const parse = vi.spyOn(JSON, "parse");
  try {
    expect(remoteSessionFor("shell")).toBe("host-before");
    expect(remoteShellBoundTo("host-before")).toBe("shell");
    expect(remoteSessionFor("missing")).toBeUndefined();
    expect(parse.mock.calls.filter(([input]) => input === raw)).toHaveLength(1);
    localStorage.setItem(key, '{"shell":"host-after"}');
    expect(remoteSessionFor("shell")).toBe("host-after");
    localStorage.setItem(key, "{");
    expect(remoteSessionFor("shell")).toBeUndefined();
    localStorage.removeItem(key);
    expect(remoteSessionFor("shell")).toBeUndefined();
  } finally {
    parse.mockRestore();
  }
});

it("binds a host session to one shell at a time", () => {
  rememberRemoteSession("shell-a", "host-1");
  rememberRemoteSession("shell-b", "host-2");
  rememberRemoteSession("shell-b", "host-1");
  expect(remoteSessionFor("shell-b")).toBe("host-1");
  expect(remoteSessionFor("shell-a")).toBeUndefined();
  expect(remoteShellBoundTo("host-1")).toBe("shell-b");
  expect(remoteShellBoundTo("host-1", "shell-b")).toBeUndefined();
});

it("leaves other bindings and re-binding the same session alone", () => {
  rememberRemoteSession("shell-a", "host-1");
  rememberRemoteSession("shell-b", "host-2");
  rememberRemoteSession("shell-a", "host-1");
  expect(remoteSessionFor("shell-a")).toBe("host-1");
  expect(remoteSessionFor("shell-b")).toBe("host-2");
  rememberRemoteSession("shell-a");
  expect(remoteSessionFor("shell-a")).toBeUndefined();
  expect(remoteSessionFor("shell-b")).toBe("host-2");
});

it("keeps Host-derived session lists out of a tab binding or unbinding", () => {
  let historyChanges = 0;
  const listener = () => historyChanges++;
  window.addEventListener(REMOTE_HISTORY_CHANGE, listener);
  rememberRemoteSession("shell-a", "host-1");
  rememberRemoteSession("shell-a", "host-2");
  rememberRemoteSession("shell-a");
  window.removeEventListener(REMOTE_HISTORY_CHANGE, listener);
  expect(historyChanges).toBe(0);
});

it("still drops the cached lists on an explicit refresh", () => {
  let historyChanges = 0;
  const listener = () => historyChanges++;
  window.addEventListener(REMOTE_HISTORY_CHANGE, listener);
  refreshRemoteProjectSessions();
  window.removeEventListener(REMOTE_HISTORY_CHANGE, listener);
  expect(historyChanges).toBe(1);
});

it("announces a binding change once", () => {
  let changes = 0;
  const listener = () => changes++;
  window.addEventListener(REMOTE_TAB_BINDING_CHANGE, listener);
  rememberRemoteSession("shell-a", "host-1");
  window.removeEventListener(REMOTE_TAB_BINDING_CHANGE, listener);
  expect(changes).toBe(1);
});
