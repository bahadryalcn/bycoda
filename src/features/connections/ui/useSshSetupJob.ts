import { invoke } from "@tauri-apps/api/core";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { SshSetup } from "../model/protocol";

const POLL_INTERVAL_MS = 350;

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
  /** Polling itself failed; the job was cancelled and the id cleared. */
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
    const poll = async () => {
      try {
        const next = await invoke<SshSetup>("remote_ssh_poll", { jobId });
        if (disposed) return;
        setJob(next);
        if (next.done) {
          currentJob.current = undefined;
          setJobId(undefined);
          done(next);
          return;
        }
      } catch (reason) {
        if (disposed) return;
        failed(reason);
        void invoke("remote_ssh_cancel", { jobId }).catch(() => {});
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
        onError(String(reason));
        return false;
      }
    },
  };
}
