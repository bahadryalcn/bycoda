// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  beginRemoteCreate,
  endRemoteCreate,
  remoteCreateIntent,
  remoteCreateIntents,
  remoteCreateShellFor,
  resetRemoteCreateIntentsForTests,
  subscribeRemoteCreateIntents,
} from "./remoteCreateIntent";

const same = (project: string) => (candidate: string) => candidate === project;

describe("remoteCreateIntent", () => {
  beforeEach(() => resetRemoteCreateIntentsForTests());

  it("marks a shell as creating until the create ends", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeRemoteCreateIntents(listener);
    const intent = beginRemoteCreate("shell-1", "remote://m/p", "env", ["old"]);
    expect(remoteCreateIntent("shell-1")).toBe(intent);
    expect(remoteCreateIntents(same("remote://m/p"))).toEqual([intent]);
    expect(remoteCreateIntents(same("remote://m/other"))).toEqual([]);
    endRemoteCreate("shell-1", intent);
    expect(remoteCreateIntent("shell-1")).toBeUndefined();
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it("does not let a stale intent end a newer one", () => {
    const first = beginRemoteCreate("shell-1", "remote://m/p", "env", []);
    const second = beginRemoteCreate("shell-1", "remote://m/p", "env", []);
    endRemoteCreate("shell-1", first);
    expect(remoteCreateIntent("shell-1")).toBe(second);
    endRemoteCreate("shell-1");
    expect(remoteCreateIntent("shell-1")).toBeUndefined();
  });

  it("attributes a newly listed session to the earliest creating shell of its project", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    beginRemoteCreate("shell-a", "remote://m/p", "env", ["known"]);
    vi.setSystemTime(2000);
    beginRemoteCreate("shell-b", "remote://m/p", "env", ["known"]);
    beginRemoteCreate("shell-c", "remote://m/other", "env", []);
    expect(remoteCreateShellFor("new", same("remote://m/p"))).toBe("shell-a");
    expect(remoteCreateShellFor("known", same("remote://m/p"))).toBeUndefined();
    expect(remoteCreateShellFor("new", same("remote://m/none"))).toBeUndefined();
    vi.useRealTimers();
  });
});
