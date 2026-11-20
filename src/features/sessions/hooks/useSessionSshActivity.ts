import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { withTimeout } from "../../../shared/lib/withTimeout";
import type { SshActivity } from "../model/sshTranscript";

const EMPTY: readonly SshActivity[] = [];
const POLL_MS = 650;

export function useSessionSshActivity(
  sessionId: string,
  serverId?: string,
): readonly SshActivity[] {
  const [snapshot, setSnapshot] = useState<{
    sessionId: string;
    serverId: string;
    rows: SshActivity[];
  }>();

  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Follow native receipts while the matching server conversation is visible.
  useEffect(() => {
    if (!serverId) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let previous = "";
    const poll = async () => {
      try {
        const rows = await withTimeout(
          invoke<SshActivity[]>("server_ssh_session_activity", { sessionId, serverId }),
          3500,
          "SSH activity",
        );
        if (disposed) return;
        const key = JSON.stringify(rows);
        if (key !== previous) {
          previous = key;
          setSnapshot({ sessionId, serverId, rows });
        }
      } catch {
        if (!disposed) {
          previous = "";
          setSnapshot(undefined);
        }
      } finally {
        if (!disposed) timer = setTimeout(() => void poll().catch(() => undefined), POLL_MS);
      }
    };
    void poll().catch(() => undefined);
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [sessionId, serverId]);

  return snapshot && snapshot.sessionId === sessionId && snapshot.serverId === serverId
    ? snapshot.rows
    : EMPTY;
}
