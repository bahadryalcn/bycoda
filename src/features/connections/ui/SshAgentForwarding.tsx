import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Alert } from "../../../shared/ui/Alert";
import { Button } from "../../../shared/ui/Button";
import { Modal } from "../../../shared/ui/Modal";
import { t } from "../../../shared/i18n";
import {
  validSshRuntimeConfiguration,
  type SshRuntimeConfiguration,
} from "../model/sshGroupDefaults";
import type { ServerRecord } from "../model/serverInventory";
import { sshEndpointPreview } from "../model/sshEndpointReview";

type Review = {
  reviewId: string;
  endpointFingerprint: string;
  expiresAt: number;
  agentAvailable: boolean;
  summary: {
    host: string;
    user?: string | null;
    port: number;
    jumpHosts: string[];
    configuration?: SshRuntimeConfiguration | null;
  };
};
function validReview(value: unknown): value is Review {
  if (!value || typeof value !== "object") return false;
  const r = value as Review;
  const text = (v: unknown): v is string =>
    typeof v === "string" && v.length > 0 && v.length <= 512 && !/[\r\n\t\0]/.test(v);
  return (
    text(r.reviewId) &&
    text(r.endpointFingerprint) &&
    Number.isFinite(r.expiresAt) &&
    typeof r.agentAvailable === "boolean" &&
    Boolean(r.summary) &&
    text(r.summary.host) &&
    (r.summary.user == null || text(r.summary.user)) &&
    Number.isInteger(r.summary.port) &&
    r.summary.port > 0 &&
    r.summary.port <= 65535 &&
    Array.isArray(r.summary.jumpHosts) &&
    r.summary.jumpHosts.length === 0 &&
    (r.summary.configuration == null || validSshRuntimeConfiguration(r.summary.configuration))
  );
}
/** One interactive terminal authorization. No saved permission or auto-renewal. */
export function SshAgentForwarding({
  server,
  onApprove,
  onClose,
}: {
  server: ServerRecord;
  onApprove: (server: ServerRecord, reviewId: string) => void;
  onClose: () => void;
}) {
  const target = JSON.stringify([
    server.id,
    server.sshEndpoint,
    server.machine?.ssh,
    server.metadata.sshInheritance,
  ]);
  const current = useRef({ server, target });
  const inFlight = useRef<{ target: string; generation: number } | undefined>(undefined);
  const sequence = useRef(0),
    mounted = useRef(false),
    used = useRef<string | undefined>(undefined);
  useLayoutEffect(() => {
    if (current.current.target !== target) {
      sequence.current += 1;
      inFlight.current = undefined;
    }
    current.current = { server, target };
  }, [server, target]);
  const [state, setState] = useState<{
    target: string;
    loading: boolean;
    review?: Review;
    error?: string;
    changed?: boolean;
  }>({ target, loading: true });
  if (state.target !== target) setState({ target, loading: false, changed: true });
  const [consumedReview, setConsumedReview] = useState<string | undefined>(undefined);
  const [expired, setExpired] = useState<string | undefined>(undefined);
  const [clock, setClock] = useState(0);
  const request = useCallback(async () => {
    const selected = current.current;
    if (inFlight.current?.target === selected.target) return;
    const generation = ++sequence.current;
    inFlight.current = { target: selected.target, generation };
    used.current = undefined;
    setConsumedReview(undefined);
    setState({ target: selected.target, loading: true });
    try {
      const result = await invoke<unknown>("ssh_agent_forwarding_review", {
        connectionId: selected.server.id,
      });
      if (
        !mounted.current ||
        generation !== sequence.current ||
        current.current.target !== selected.target
      )
        return;
      if (!validReview(result) || result.expiresAt > Date.now() + 30_000)
        throw new Error(t("Agent forwarding review is unavailable. Request a new review."));
      const endpoint = selected.server.sshEndpoint;
      const inherited = Boolean(
        selected.server.metadata.sshInheritance &&
        result.summary.configuration &&
        validSshRuntimeConfiguration(result.summary.configuration),
      );
      if (
        endpoint &&
        (result.summary.host.toLowerCase() !== endpoint.host.toLowerCase() ||
          (!inherited &&
            (result.summary.port !== endpoint.port ||
              (result.summary.user ?? "") !== (endpoint.user ?? ""))))
      )
        throw new Error(t("Agent forwarding target changed. Request a new review."));
      setClock(Date.now());
      setState({ target: selected.target, loading: false, review: result });
    } catch (reason) {
      if (
        mounted.current &&
        generation === sequence.current &&
        current.current.target === selected.target
      )
        setState({ target: selected.target, loading: false, error: String(reason) });
    } finally {
      if (inFlight.current?.generation === generation) inFlight.current = undefined;
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void request();
    return () => {
      mounted.current = false;
      sequence.current += 1;
      inFlight.current = undefined;
    };
  }, [request]);
  const active = state.target === target ? state : undefined;
  const review = active?.review;
  useEffect(() => {
    if (!review) return;
    const delay = Math.max(0, Math.min(30_000, review.expiresAt - Date.now()));
    const timeout = setTimeout(() => setExpired(review.reviewId), delay);
    const interval = setInterval(() => setClock(Date.now()), 250);
    return () => {
      clearTimeout(timeout);
      clearInterval(interval);
    };
  }, [review]);
  const valid = Boolean(
    review?.agentAvailable &&
    review.expiresAt > clock &&
    expired !== review.reviewId &&
    consumedReview !== review.reviewId &&
    !active?.loading,
  );
  const approve = () => {
    if (
      !valid ||
      !review ||
      used.current === review.reviewId ||
      review.expiresAt <= Date.now() ||
      active?.target !== current.current.target
    )
      return;
    used.current = review.reviewId;
    setConsumedReview(review.reviewId);
    try {
      onApprove(current.current.server, review.reviewId);
      onClose();
    } catch (reason) {
      setState({ target, loading: false, error: String(reason) });
    }
  };
  return (
    <Modal title={t("Forward SSH agent")} onClose={onClose} size="sm">
      <div className="flex min-w-0 flex-col gap-3 p-4">
        <Alert tone="warning">
          {t(
            "The remote target can use identities from your SSH agent while this terminal is connected. Approve only a trusted target.",
          )}
        </Alert>
        {active?.loading ? (
          <p role="status" className="text-xs text-(--ui-text-muted)">
            {t("Loading…")}
          </p>
        ) : null}
        {active?.error ? (
          <Alert tone="danger" role="alert">
            {active.error}
          </Alert>
        ) : null}
        {review ? (
          <>
            <p className="break-all text-sm font-medium">
              {sshEndpointPreview({ ...review.summary, user: review.summary.user ?? undefined })}
            </p>
            {server.sshEndpoint?.httpProxy ? (
              <p className="break-all text-xs text-(--ui-text-muted)">
                {server.sshEndpoint.httpProxy.scheme === "https" ? "HTTPS CONNECT" : "HTTP CONNECT"}
                : {sshEndpointPreview(server.sshEndpoint.httpProxy)}
              </p>
            ) : null}
            {review.summary.configuration ? (
              <details className="text-xs text-(--ui-text-muted)">
                <summary className="cursor-pointer">{t("Effective SSH configuration")}</summary>
                <dl className="mbs-2 grid grid-cols-2 gap-1">
                  {Object.entries(review.summary.configuration.provenance).map(
                    ([field, source]) => (
                      <div key={field} className="contents">
                        <dt>{field}</dt>
                        <dd>
                          {t(
                            source.source === "group"
                              ? "Group"
                              : source.source === "connection"
                                ? "Connection"
                                : "Default",
                          )}
                          {source.groupId ? ` · ${source.groupId} · r${source.revision}` : ""}
                        </dd>
                      </div>
                    ),
                  )}
                </dl>
                {review.summary.configuration.environment.length ? (
                  <p>
                    {t("Environment shell")}:{" "}
                    {review.summary.configuration.shellKind === "powershell"
                      ? "PowerShell"
                      : "POSIX"}
                  </p>
                ) : null}
                {review.summary.configuration.environment.map((entry) => (
                  <p key={entry.name} className="break-all">
                    <code>
                      {entry.name}={entry.value}
                    </code>
                  </p>
                ))}
              </details>
            ) : null}
            <p className="text-xs text-(--ui-text-muted)">
              {t("One terminal only. Approval is not saved.")} ·{" "}
              {Math.max(0, Math.ceil((review.expiresAt - clock) / 1000))} s
            </p>
            {!valid ? (
              <p role="status" className="text-xs text-(--ui-text-muted)">
                {t("This review expired or is unavailable. Request a new review.")}
              </p>
            ) : null}
          </>
        ) : null}
        {!active || active.changed ? (
          <p role="status" className="text-xs text-(--ui-text-muted)">
            {t("Agent forwarding target changed. Request a new review.")}
          </p>
        ) : null}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t("Cancel")}
          </Button>
          <Button disabled={active?.loading} onClick={() => void request()}>
            {t("Request new review")}
          </Button>
          <Button variant="primary" disabled={!valid} onClick={approve}>
            {t("Approve and connect")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
