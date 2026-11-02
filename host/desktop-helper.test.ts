import { expect, it, vi } from "vitest";
import { HostDesktopHelper } from "./desktop-helper";
import type { PreparedDesktopHelper } from "../scripts/setup/agent-desktop.mjs";

const prepared = {
  binaryPath: "/private/helper.exe",
  binarySha256: "a".repeat(64),
  sourceRef: "pinned",
  protocol: "2.5",
  version: "1.0.2",
  manifestPath: "/private/manifest.json",
} as PreparedDesktopHelper;
const allowed = async () => true;
it("never builds during discovery and refuses missing owner authority", async () => {
  const prepare = vi.fn(),
    read = vi.fn(async () => undefined),
    helper = new HostDesktopHelper({ read, prepare });
  expect(await helper.request({ op: "status" }, allowed)).toEqual({ phase: "missing" });
  expect(prepare).not.toHaveBeenCalled();
  await expect(helper.request({ op: "prepare" }, async () => false)).rejects.toThrow(
    "owner authority",
  );
  expect(prepare).not.toHaveBeenCalled();
  await helper.close();
});
it("runs one explicitly requested preparation and returns verified metadata without enabling control", async () => {
  let finish!: (helper: PreparedDesktopHelper) => void;
  const prepare = vi.fn(
    () =>
      new Promise<PreparedDesktopHelper>((resolve) => {
        finish = resolve;
      }),
  );
  let available: PreparedDesktopHelper | undefined;
  const helper = new HostDesktopHelper({ read: async () => available, prepare });
  expect((await helper.request({ op: "prepare" }, allowed)).phase).toBe("preparing");
  await helper.request({ op: "prepare" }, allowed);
  expect(prepare).toHaveBeenCalledOnce();
  available = prepared;
  finish(prepared);
  await vi.waitFor(async () =>
    expect((await helper.request({ op: "status" }, allowed)).helper?.binarySha256).toBe(
      prepared.binarySha256,
    ),
  );
  await helper.close();
});
it("reports interruption only after its owned preparation has settled", async () => {
  let stopped!: () => void;
  const helper = new HostDesktopHelper({
    read: async () => undefined,
    prepare: (options) =>
      new Promise((_resolve, reject) => {
        options.signal!.addEventListener(
          "abort",
          () => {
            stopped = () => reject(new Error("The owned build was interrupted."));
          },
          { once: true },
        );
      }),
  });
  await helper.request({ op: "prepare" }, allowed);
  let returned = false;
  const cancelled = helper.request({ op: "cancel" }, allowed).then((result) => {
    returned = true;
    return result;
  });
  await vi.waitFor(() => expect(stopped).toBeTypeOf("function"));
  expect(returned).toBe(false);
  stopped();
  expect((await cancelled).phase).toBe("interrupted");
  await helper.close();
});
it("rejects unknown parameters and retains a failed preparation for explicit retry", async () => {
  const helper = new HostDesktopHelper({
    read: async () => undefined,
    prepare: async () => {
      throw new Error("The pinned compiler is unavailable.");
    },
  });
  await expect(helper.request({ op: "prepare", enable: true }, allowed)).rejects.toThrow();
  await helper.request({ op: "prepare" }, allowed);
  await vi.waitFor(async () =>
    expect((await helper.request({ op: "status" }, allowed)).phase).toBe("failed"),
  );
  expect((await helper.request({ op: "status" }, allowed)).error).toContain("compiler");
  await helper.close();
});
