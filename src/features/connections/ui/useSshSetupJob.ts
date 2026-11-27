import { invoke } from "@tauri-apps/api/core";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { withTimeout } from "../../../shared/lib/withTimeout";
import type { SshSetup } from "../model/protocol";
import { errorText } from "../../../shared/lib/errors";
import { sanitizeConnectionError } from "../model/remoteConnection";

const POLL_INTERVAL_MS = 350;
/** One status read that outlasts this counts as a failed read. */
const POLL_DEADLINE_MS = 5_000;
/** Consecutive failed reads tolerated (backed off 0.7 s, 1.4 s, 2.8 s) before the job is dropped. */
const MAX_POLL_RETRIES = 3;
const CANCEL_DEADLINE_MS = 2_000;
/** The native error for an id that no longer exists; retrying it cannot succeed. */
const JOB_GONE = "Connection setup has expired";

/** Polls one native SSH setup job and forwards its prompt answers.
 *
 * The caller owns what a finished or failed job means for its form; this hook
 * owns the job id, the latest snapshot, polling and cancelling on unmount. */
export function useSshSetupJob({
  onDone,
  onFailed,
  onError,
}: {
  /** The job finished (successfully or with `job.error`); the id is already cleared. */
  onDone: (job: SshSetup) => void;
  /** Polling failed repeatedly or the job is gone; the job was cancelled and the id cleared. */
  onFailed: (reason: unknown) => void;
  /** An answer could not be delivered; called with "" when one is sent. */
  onError: (message: string) => void;
}) {
  const [jobId, setJobId] = useState<string>();
  const [job, setJob] = useState<SshSetup>();
  const alive = useRef(true);
  const currentJob = useRef<string | undefined>(undefined);
  const progress = useRef<HTMLDivElement>(null);
  const done = useEffectEvent(onDone);
  const failed = useEffectEvent(onFailed);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (currentJob.current)
        void invoke("remote_ssh_cancel", { jobId: currentJob.current }).catch(() => {});
    };
  }, []);
  useEffect(() => {
    if (!jobId) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    // A read that fails once says nothing about the job: it keeps running natively and
    // may be waiting on a prompt. Only consecutive failures, or a job the native side
    // no longer knows, end it.
    let failures = 0;
    const poll = async () => {
      try {
        const next = await withTimeout(
          invoke<SshSetup>("remote_ssh_poll", { jobId }),
          POLL_DEADLINE_MS,
          "SSH setup status",
        );
        if (disposed) return;
        failures = 0;
        setJob(next);
        if (next.done) {
          currentJob.current = undefined;
          setJobId(undefined);
          done(next);
          return;
        }
      } catch (reason) {
        if (disposed) return;
        failures += 1;
        if (!String(reason).includes(JOB_GONE) && failures <= MAX_POLL_RETRIES) {
          timer = setTimeout(() => void poll(), POLL_INTERVAL_MS * 2 ** failures);
          return;
        }
        failed(reason);
        void withTimeout(
          invoke("remote_ssh_cancel", { jobId }),
          CANCEL_DEADLINE_MS,
          "SSH setup cancel",
        ).catch(() => {});
        currentJob.current = undefined;
        setJobId(undefined);
        return;
      }
      timer = setTimeout(() => void poll(), POLL_INTERVAL_MS);
    };
    void poll();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [jobId]);
  const promptId = job?.prompt?.id;
  useEffect(() => {
    if (promptId)
      progress.current?.scrollIntoView?.({
        block: "nearest",
        behavior: "smooth",
      });
  }, [promptId]);
  return {
    jobId,
    job,
    /** True until the owning component unmounts. */
    alive,
    progress,
    /** Starts following a job the native side just created. */
    attach: (id: string) => {
      currentJob.current = id;
      setJobId(id);
    },
    /** Forgets the last snapshot, e.g. when a form replaces the progress card. */
    clearSnapshot: () => setJob(undefined),
    cancel: (id: string) => invoke("remote_ssh_cancel", { jobId: id }),
    /** Sends the answer for the current prompt; resolves false when it failed. */
    respond: async (value: string): Promise<boolean> => {
      if (!jobId || !job?.prompt) return false;
      onError("");
      try {
        await invoke("remote_ssh_answer", { jobId, promptId: job.prompt.id, answer: value });
        return true;
      } catch (reason) {
        onError(sanitizeConnectionError(errorText(reason)));
        return false;
      }
    },
  };
}
