import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import type { TunnelEvent } from "./tunnel-providers";

const state = vi.hoisted(() => ({ prepare: vi.fn() }));
vi.mock("../provider-guardian-deployment", () => ({ prepareProviderGuardian: state.prepare }));
import { startNativeTunnel } from "./native-tunnel-process";

describe("native tunnel guardian", () => {
  it("passes credentials through the private launch and fences unknown retirement", async () => {
    let rejectRetirement!: (error: Error) => void;
    const retirement = new Promise<void>((_, reject) => {
      rejectRetirement = reject;
    });
    void retirement.catch(() => {});
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      started: Promise.resolve(),
      retirement,
      retirementVerified: false,
      stop: vi.fn(async () => {
        throw new Error("unknown");
      }),
    });
    const spawn = vi.fn((_launch: { args: string[]; env: NodeJS.ProcessEnv }) => child);
    state.prepare.mockResolvedValue({
      supportsTunnelCustody: async () => true,
      spawn,
      dispose: async () => {},
    });
    const events: TunnelEvent[] = [];
    const owned = startNativeTunnel(
      { provider: "ngrok", program: "fake", args: ["http"], token: "private-token" },
      (event) => events.push(event),
      () => {
        throw new Error("fallback");
      },
    );
    await vi.waitFor(() => expect(spawn).toHaveBeenCalled());
    const launch = spawn.mock.calls[0][0];
    expect(launch.args.join(" ")).not.toContain("private-token");
    expect(launch.env.NGROK_AUTHTOKEN).toBe("private-token");
    rejectRetirement(new Error("guardian lost"));
    child.emit("close");
    await vi.waitFor(() => expect(events).toContainEqual({ type: "error", issue: "stop-failed" }));
    expect(events).not.toContainEqual({ type: "exit" });
    await expect(owned.stop()).rejects.toThrow();
  });
});
