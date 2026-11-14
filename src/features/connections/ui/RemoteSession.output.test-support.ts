import { act } from "react";
import { expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import type { HostSession } from "../model/protocol";
import type { RemoteSessionOverrides } from "./RemoteSession";

/** Registers output coverage against the existing RemoteSession integration fixture. */
export function outputTest(
  seed: () => void,
  readHost: () => HostSession,
  render: () => Promise<void>,
  readOverrides: () => RemoteSessionOverrides,
) {
  it("propagates full-output failures to the requesting control and preserves the remote summary for retry", async () => {
    seed();
    const host = readHost();
    const summary = {
      ...host.session.blocks[1],
      remoteContent: { revision: host.revision, bytes: 9000 },
    };
    host.session.blocks = [summary];
    const full = { ...summary, remoteContent: undefined, text: "Full output" };
    const loaded = { ...host, session: { ...host.session, blocks: [full] } };
    const wire = vi.mocked(invoke).getMockImplementation()!;
    let failed = true;
    vi.mocked(invoke).mockImplementation(async (command, input) => {
      if (
        command === "remote_request" &&
        (input as { method?: string }).method === "sessions.block"
      ) {
        if (failed) throw new Error("Block read unavailable");
        return { kind: "snapshot", value: loaded };
      }
      return wire(command, input);
    });
    await render();
    await act(async () => {
      await expect(
        readOverrides().onLoadRemoteBlock!(summary.id, summary.remoteContent.revision),
      ).rejects.toThrow("Block read unavailable");
    });
    expect(readOverrides().remoteHistoryError).toContain("Block read unavailable");
    expect(readOverrides().session?.blocks[0].remoteContent).toEqual(summary.remoteContent);
    failed = false;
    await act(async () =>
      readOverrides().onLoadRemoteBlock!(summary.id, summary.remoteContent.revision),
    );
    expect(readOverrides().session?.blocks[0].remoteContent).toBeUndefined();
    expect(readOverrides().session?.blocks[0].text).toBe("Full output");
  });
}
