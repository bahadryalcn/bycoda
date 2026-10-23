// @vitest-environment happy-dom
import { afterEach, expect, it } from "vitest";
import {
  REMOTE_TAB_BINDING_CHANGE,
  rememberRemoteSession,
  remoteSessionFor,
  remoteShellBoundTo,
} from "./connections";

afterEach(() => localStorage.clear());

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

it("announces a binding change once", () => {
  let changes = 0;
  const listener = () => changes++;
  window.addEventListener(REMOTE_TAB_BINDING_CHANGE, listener);
  rememberRemoteSession("shell-a", "host-1");
  window.removeEventListener(REMOTE_TAB_BINDING_CHANGE, listener);
  expect(changes).toBe(1);
});
