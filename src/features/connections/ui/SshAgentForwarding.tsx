import { Code } from "../../../shared/ui/Code";
import { Text } from "../../../shared/ui/Text";
import { DescriptionItem, DescriptionList } from "../../../shared/ui/DescriptionList";
import { Disclosure } from "../../../shared/ui/Disclosure";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ErrorDetails } from "../../../shared/ui/ErrorDetails";
import { Alert } from "../../../shared/ui/Alert";
import { Button } from "../../../shared/ui/Button";
import { sshProxyEndpointText } from "./sshProxyEndpointText";
import { sshProvenanceText } from "./sshProvenanceText";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { Modal, ModalActions } from "../../../shared/ui/Modal";
import { t } from "../../../shared/i18n";
import {
  validSshRuntimeConfiguration,
  type SshRuntimeConfiguration,
} from "../model/sshGroupDefaults";
import type { ServerRecord } from "../model/serverInventory";
import { sshEndpointPreview } from "../model/sshEndpointReview";
import { errorText } from "../../../shared/lib/errors";
import { sanitizeConnectionError } from "../model/remoteConnection";

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
/** One interactive terminal authorization. No saved permission; an expired review is refetched but never approved automatically. */
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
  }>({ target, loading: true });
  // A changed target drops the old review at once; the effect below asks for a fresh one.
  if (state.target !== target) setState({ target, loading: true });
  const [consumedReview, setConsumedReview] = useState<string | undefined>(undefined);
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
      if (
        !validReview(result) ||
        !result.agentAvailable ||
        result.expiresAt <= Date.now() ||
        result.expiresAt > Date.now() + 30_000
      )
        throw new Error(t("Agent forwarding review is unavailable."));
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
        throw new Error(t("Agent forwarding target changed."));
      setState({ target: selected.target, loading: false, review: result });
    } catch (reason) {
      if (
        mounted.current &&
        generation === sequence.current &&
        current.current.target === selected.target
      )
        setState({
          target: selected.target,
          loading: false,
          error: sanitizeConnectionError(errorText(reason)),
        });
    } finally {
      if (inFlight.current?.generation === generation) inFlight.current = undefined;
    }
  }, []);
  // Requests a review on open and again whenever the reviewed target changes; each review is
  // one-use, and the dialog only shows what the native side returned for the current target.
  useEffect(() => {
    mounted.current = true;
    void request();
    return () => {
      mounted.current = false;
      sequence.current += 1;
      inFlight.current = undefined;
    };
  }, [request, target]);
  const active = state.target === target ? state : undefined;
  const review = active?.review;
  // An expired review is replaced by a fresh one; the user still approves explicitly.
  useEffect(() => {
    // An approved review is spent: nothing to renew.
    if (!review || consumedReview === review.reviewId) return;
    const timeout = setTimeout(() => void request(), Math.max(0, review.expiresAt - Date.now()));
    return () => clearTimeout(timeout);
  }, [review, consumedReview, request]);
  const valid = Boolean(
    review?.agentAvailable && consumedReview !== review.reviewId && !active?.loading,
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
      setState({ target, loading: false, error: sanitizeConnectionError(errorText(reason)) });
    }
  };
  return (
    <Modal
      title={t("Forward SSH agent")}
      onClose={onClose}
      size="sm"
      footer={
        <ModalActions>
          <Button variant="ghost" onClick={onClose}>
            {t("Cancel")}
          </Button>
          <Button
            variant="primary"
            disabled={!valid}
            disabledReason={active?.loading ? t("Reviewing the target…") : undefined}
            onClick={approve}
          >
            {t("Approve and connect")}
          </Button>
        </ModalActions>
      }
    >
      <div className="flex min-w-0 flex-col gap-3">
        <Alert tone="warning">
          {t(
            "The remote target can use identities from your SSH agent while this one terminal is connected. Approval is not saved. Approve only a trusted target.",
          )}
        </Alert>
        {active?.error ? (
          <Alert
            tone="danger"
            action={{ label: t("Retry"), onClick: () => void request() }}
            extra={
              <ErrorDetails
                title={t("Could not review the SSH agent target.")}
                detail={active.error}
              />
            }
          >
            {t("Could not review the SSH agent target.")}
          </Alert>
        ) : active?.loading ? (
          <LoadingText />
        ) : null}
        {review ? (
          <>
            <Text as="p" size="body" tone="inherit" weight="medium" className="break-all">
              {sshEndpointPreview({ ...review.summary, user: review.summary.user ?? undefined })}
            </Text>
            {server.sshEndpoint?.httpProxy ? (
              <Text as="p" tone="muted" className="break-all">
                {sshProxyEndpointText(server.sshEndpoint.httpProxy)}
              </Text>
            ) : null}
            {review.summary.configuration ? (
              <Disclosure size="sm" summary={t("Effective SSH configuration")}>
                <DescriptionList size="sm">
                  {Object.entries(review.summary.configuration.provenance).map(
                    ([field, source]) => (
                      <DescriptionItem key={field} term={field}>
                        {sshProvenanceText(source)}
                      </DescriptionItem>
                    ),
                  )}
                </DescriptionList>
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
                    <Code>
                      {entry.name}={entry.value}
                    </Code>
                  </p>
                ))}
              </Disclosure>
            ) : null}
          </>
        ) : null}
      </div>
    </Modal>
  );
}
