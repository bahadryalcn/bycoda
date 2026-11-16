import { describe, expect, it, vi } from "vitest";

/** Each import is one desktop window with its own module state. */
async function window() {
  vi.resetModules();
  return import("./writerHandoff");
}

describe("writer handoff between desktop windows", () => {
  it("lets the holding window retire its writer for the requester", async () => {
    const holder = await window();
    const released: string[] = [];
    holder.serveWriterHandoff(async (sessionId) => {
      if (sessionId !== "s1") return false;
      released.push(sessionId);
      return true;
    });
    const requester = await window();
    await expect(requester.requestWriterHandoff("s1", 2_000)).resolves.toBe(true);
    expect(released).toEqual(["s1"]);
  });

  it("reports the holder's refusal and times out when nobody holds the writer", async () => {
    const holder = await window();
    holder.serveWriterHandoff(async (sessionId) => {
      if (sessionId === "busy") throw new Error("still running");
      return false;
    });
    const requester = await window();
    await expect(requester.requestWriterHandoff("busy", 2_000)).rejects.toThrow("still running");
    await expect(requester.requestWriterHandoff("free", 50)).resolves.toBe(false);
  });

  it("never answers its own window's request", async () => {
    const single = await window();
    const release = vi.fn(async () => true);
    single.serveWriterHandoff(release);
    await expect(single.requestWriterHandoff("s2", 50)).resolves.toBe(false);
    expect(release).not.toHaveBeenCalled();
  });
});
