import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { t } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Modal } from "../../../shared/ui/Modal";
import { Alert } from "../../../shared/ui/Alert";
import { refreshSshRunbookQueue, useSshRunbookQueue } from "../model/sshRunbookQueue";
import {
  dismissSshRunbookIntent,
  listSshRunbooks,
  type SshRunbookIntent,
} from "../model/sshRunbooks";
import type { ServerRecord } from "../model/serverInventory";
import { SshRunbooks } from "./SshRunbooks";

export function SshRunbookQueue({ openRequest = 0 }: { openRequest?: number }) {
  const queue = useSshRunbookQueue();
  const [open, setOpen] = useState(false);
  const [seenOpenRequest, setSeenOpenRequest] = useState(openRequest);
  if (openRequest !== seenOpenRequest) {
    setSeenOpenRequest(openRequest);
    setOpen(true);
  }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reviewOpen, setReviewOpen] = useState(false);
  const [review, setReview] = useState<{
    server: ServerRecord;
    servers: ServerRecord[];
    intent: SshRunbookIntent;
    runId?: string;
  }>();
  const mounted = useRef(false);
  const operationPending = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const operation = async (action: () => Promise<void>) => {
    if (operationPending.current) return;
    operationPending.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (reason) {
      if (mounted.current) setError(String(reason));
    } finally {
      operationPending.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  return (
    <>
      {queue.intents.length || queue.error || review?.runId ? (
        <div className="flex shrink-0 items-center justify-end gap-2 border-b border-stroke px-3 py-1 text-xs">
          <Button variant="ghost" onClick={() => setOpen(true)}>
            {t("SSH reviews")} · {queue.intents.length}
          </Button>
        </div>
      ) : null}
      {open && !reviewOpen ? (
        <Modal title={t("SSH reviews")} onClose={() => setOpen(false)} size="md">
          <div className="flex min-w-0 flex-col gap-2 p-4">
            {error || queue.error ? (
              <Alert tone="danger" role="alert">
                {error || queue.error}
              </Alert>
            ) : null}
            <div className="flex justify-end gap-2">
              {review?.runId ? (
                <Button disabled={busy} onClick={() => setReviewOpen(true)}>
                  {t("Last execution")}
                </Button>
              ) : null}
              <Button disabled={busy} onClick={() => void operation(refreshSshRunbookQueue)}>
                {t("Refresh")}
              </Button>
            </div>
            {queue.intents.map((intent) => (
              <div
                key={intent.id}
                className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-b border-stroke py-2 text-xs"
              >
                <span className="min-w-0 break-all">
                  {t(intent.trigger === "startup" ? "Startup" : "Scheduled")} ·{" "}
                  {intent.automationId} · r{intent.revision}
                </span>
                <div className="flex gap-2">
                  <Button
                    disabled={busy}
                    onClick={() =>
                      void operation(async () => {
                        await dismissSshRunbookIntent(intent.id);
                        await refreshSshRunbookQueue();
                      })
                    }
                  >
                    {t("Dismiss")}
                  </Button>
                  <Button
                    disabled={busy}
                    onClick={() =>
                      void operation(async () => {
                        const [servers, profiles] = await Promise.all([
                          invoke<ServerRecord[]>("server_inventory_list"),
                          listSshRunbooks(),
                        ]);
                        const profile = profiles.find(
                          (entry) =>
                            entry.id === intent.automationId && entry.revision === intent.revision,
                        );
                        const server = servers.find(
                          (entry) => entry.kind === "ssh" && profile?.targetIds.includes(entry.id),
                        );
                        if (!profile || !server)
                          throw new Error(t("Runbook changed. Refresh and review again."));
                        if (!mounted.current) return;
                        setReview({ server, servers, intent });
                        setReviewOpen(true);
                      })
                    }
                  >
                    {t("Review execution")}
                  </Button>
                </div>
              </div>
            ))}
            {!queue.intents.length ? (
              <p className="text-xs text-(--ui-text-muted)">{t("No pending SSH reviews.")}</p>
            ) : null}
          </div>
        </Modal>
      ) : null}
      {open && reviewOpen && review ? (
        <SshRunbooks
          server={review.server}
          servers={review.servers}
          initialAutomationId={review.intent.automationId}
          intentId={review.runId ? undefined : review.intent.id}
          runId={review.runId}
          onRun={(runId) => {
            setReview((current) => (current ? { ...current, runId } : current));
            // The saved ID survives an ambiguous response; refreshing metadata never starts it.
            void refreshSshRunbookQueue();
          }}
          onAbandon={() => {
            setReview((current) => (current ? { ...current, runId: undefined } : current));
            void refreshSshRunbookQueue();
          }}
          onClose={() => {
            setReviewOpen(false);
            void refreshSshRunbookQueue();
          }}
        />
      ) : null}
    </>
  );
}
