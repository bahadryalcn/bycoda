import { describeRemoteError } from "../../connections/public/remoteFailure";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { Code } from "../../../shared/ui/Code";
import { OutputBlock } from "../../../shared/ui/OutputBlock";
import { Text } from "../../../shared/ui/Text";
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useRemoteMachines } from "../../connections/model/connections";
import { t } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Modal, ModalActions } from "../../../shared/ui/Modal";
import { Select } from "../../../shared/ui/Select";
import { TextField } from "../../../shared/ui/TextField";
import { InlineError } from "../../../shared/ui/InlineError";
import styles from "./AssistantRemoteAccess.module.css";
/** A failure as the translated sentence plus optional raw text for Details. */
type Problem = { message: string; details?: string };
const actionError = (cause: unknown): Problem => describeRemoteError(cause);

type NativeIdentity = {
  installationId: string;
  publicKey: string;
  fingerprint: string;
};
type RemoteDraft = {
  machineId: string;
  projectId: string;
  scope: string;
  duration: string;
};
const drafts = new Map<string, RemoteDraft>();
type OriginalRequest = { machineId: string; requestId: string };
const requestKey = (key: string) => `bycoda.room-delegation.request:${key}`;
function readRequest(key: string): OriginalRequest | undefined {
  try {
    const value = JSON.parse(
      localStorage.getItem(requestKey(key)) ?? "null",
    ) as OriginalRequest | null;
    return value && typeof value.machineId === "string" && typeof value.requestId === "string"
      ? value
      : undefined;
  } catch {
    return undefined;
  }
}
/**
 * Controlled "Remote Room access" modal for one Room thread. Keep it mounted (keyed by
 * environment + thread) so drafts and request recovery survive closing; the parent owns `open`.
 */
export function AssistantRemoteAccess({
  threadId,
  environmentId,
  sourceStatus,
  open,
  onClose,
}: {
  threadId: string;
  environmentId?: string;
  sourceStatus: "pending" | "registered" | "unavailable";
  open: boolean;
  onClose: () => void;
}) {
  const draftKey = JSON.stringify([environmentId, threadId]);
  const [machineId, setMachineId] = useState(() => drafts.get(draftKey)?.machineId ?? "");
  const [projectId, setProjectId] = useState(() => drafts.get(draftKey)?.projectId ?? "");
  const [scope, setScope] = useState(() => drafts.get(draftKey)?.scope ?? "read");
  const [duration, setDuration] = useState(() => drafts.get(draftKey)?.duration ?? "1");
  useEffect(() => {
    drafts.set(draftKey, { machineId, projectId, scope, duration });
  }, [draftKey, machineId, projectId, scope, duration]);
  const [identity, setIdentity] = useState<NativeIdentity>();
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [request, setRequest] = useState(() => readRequest(draftKey));
  const [result, setResult] = useState("");
  const [retainedGrant, setRetainedGrant] = useState("");
  const { machines, loading, error: machinesError } = useRemoteMachines(open);
  const targets = machines.filter(
    (machine) => machine.environmentId && machine.environmentId !== environmentId,
  );
  async function showIdentity() {
    setPending(true);
    setProblem(null);
    try {
      setIdentity(await invoke<NativeIdentity>("room_delegation_native_identity"));
    } catch (cause) {
      setProblem(actionError(cause));
    } finally {
      setPending(false);
    }
  }
  async function connect() {
    if (!machineId || !projectId.trim() || request) return;
    const original = { machineId, requestId: crypto.randomUUID() };
    try {
      localStorage.setItem(requestKey(draftKey), JSON.stringify(original));
    } catch {
      setProblem({ message: t("Cannot retain the original request. Connection was not started.") });
      return;
    }
    setRequest(original);
    setPending(true);
    setProblem(null);
    setResult("");
    const actions = [
      "sessions.list",
      "sessions.read",
      "tasks.list",
      "tasks.get",
      ...(scope === "manage" ? ["tasks.create", "tasks.update"] : []),
    ];
    try {
      const grant = await invoke<{ grantId: string; expiresAt: number }>("room_delegation_issue", {
        machineId,
        threadId,
        projectId: projectId.trim(),
        actions,
        expiresAt: Date.now() + Number(duration) * 60 * 60 * 1000,
        requestId: original.requestId,
      });
      setResult(`${t("Grant issued")}: ${grant.grantId}`);
      localStorage.removeItem(requestKey(draftKey));
      setRequest(undefined);
    } catch (cause) {
      const failure = actionError(cause);
      if (failure.message === "Room delegation cancelled") {
        localStorage.removeItem(requestKey(draftKey));
        setRequest(undefined);
      }
      setProblem(failure);
    } finally {
      setPending(false);
    }
  }
  async function inspect() {
    if (!request) return;
    setPending(true);
    setProblem(null);
    try {
      const status = await invoke<{
        state: string;
        result?: { grantId?: string };
      }>("room_delegation_issue_status", {
        machineId: request.machineId,
        threadId,
        requestId: request.requestId,
      });
      setRetainedGrant(status.result?.grantId ?? "");
      setResult(
        `${t("Original request")}: ${status.state}${status.result?.grantId ? ` (${status.result.grantId})` : ""}`,
      );
    } catch (cause) {
      setProblem(actionError(cause));
    } finally {
      setPending(false);
    }
  }
  async function revokeRetained() {
    if (!request || !retainedGrant) return;
    setPending(true);
    setProblem(null);
    try {
      await invoke("room_delegation_revoke_retained", {
        machineId: request.machineId,
        threadId,
        grantId: retainedGrant,
      });
      localStorage.removeItem(requestKey(draftKey));
      setRequest(undefined);
      setRetainedGrant("");
      setResult(t("Original grant revoked."));
    } catch (cause) {
      setProblem(actionError(cause));
    } finally {
      setPending(false);
    }
  }
  const connectReason = request
    ? t("Check or revoke the original request first.")
    : sourceStatus !== "registered"
      ? t("Room registration is not ready.")
      : !machineId
        ? t("Choose a paired Host first.")
        : !projectId.trim()
          ? t("Enter the target project ID first.")
          : undefined;
  return (
    <>
      {open && (
        <Modal
          title={t("Remote Room access")}
          size="md"
          onClose={onClose}
          footer={
            <ModalActions reason={connectReason}>
              <Button onClick={onClose}>{t("Close")}</Button>
              <Button
                variant="primary"
                loading={pending}
                disabled={
                  pending ||
                  !!request ||
                  sourceStatus !== "registered" ||
                  !machineId ||
                  !projectId.trim()
                }
                onClick={() => {
                  void connect().catch((cause: unknown) => setProblem(actionError(cause)));
                }}
              >
                {t("Connect")}
              </Button>
            </ModalActions>
          }
        >
          <div className={styles.body}>
            {/* A healthy registration needs no sentence; only the checking and failed states do. */}
            {sourceStatus !== "registered" && (
              <Text
                as="p"
                size="caption"
                tone="secondary"
                leading="normal"
                className={styles.status}
              >
                {sourceStatus === "unavailable"
                  ? t("Room registration is unavailable. Reopen the Room to retry.")
                  : t("Checking Room registration…")}
              </Text>
            )}
            <div className={styles.grid}>
              <Select
                label={t("Paired Host")}
                value={machineId}
                onValueChange={setMachineId}
                disabled={loading || !targets.length}
                options={[
                  { value: "", label: t("Choose a paired Host"), disabled: true },
                  ...targets.map((machine) => ({
                    value: machine.id,
                    label: `${machine.name} (${machine.environmentId})`,
                  })),
                ]}
              />
              <TextField
                label={t("Target project ID")}
                value={projectId}
                onChange={(event) => setProjectId(event.currentTarget.value)}
              />
              <Select
                label={t("Scope")}
                value={scope}
                onValueChange={setScope}
                options={[
                  { value: "read", label: t("Read conversations and tasks") },
                  { value: "manage", label: t("Read and manage tasks") },
                ]}
              />
              <Select
                label={t("Duration")}
                value={duration}
                onValueChange={setDuration}
                options={[
                  { value: "1", label: t("1 hour") },
                  { value: "24", label: t("24 hours") },
                ]}
              />
            </div>
            {machinesError && (
              <InlineError details={machinesError}>{t("Could not load machines.")}</InlineError>
            )}
            {!loading && !machinesError && !targets.length && (
              <EmptyState
                size="inline"
                kind="empty"
                className={styles.note}
                description={t("No other paired Host is available.")}
              />
            )}
            <Text as="p" size="caption" tone="secondary" leading="normal" className={styles.note}>
              {t(
                "The target project must be visible and the native identity trusted by both Hosts. Each connection requires native review.",
              )}
            </Text>
            {request && (
              <div
                {...surfaceAttributes(
                  { variant: "card", frame: "card", radius: "card" },
                  styles.request,
                )}
              >
                <Text as="p" leading="normal">
                  {t("Inspect the original request before starting another connection.")}{" "}
                  <Code>{request.requestId}</Code>
                </Text>
                <div className={styles.actions}>
                  <Button
                    disabled={pending}
                    onClick={() => {
                      void inspect().catch((cause: unknown) => setProblem(actionError(cause)));
                    }}
                  >
                    {t("Inspect request")}
                  </Button>
                  {retainedGrant && (
                    <Button
                      disabled={pending}
                      onClick={() => {
                        void revokeRetained().catch((cause: unknown) =>
                          setProblem(actionError(cause)),
                        );
                      }}
                    >
                      {t("Revoke original grant")}
                    </Button>
                  )}
                </div>
              </div>
            )}
            {result && (
              <Text
                as="p"
                size="secondary"
                tone="inherit"
                leading="inherit"
                className={styles.result}
              >
                {result}
              </Text>
            )}
            <div className={styles.actions}>
              <Button
                variant="ghost"
                loading={pending}
                disabled={pending}
                onClick={() => {
                  void showIdentity().catch((cause) => setProblem(actionError(cause)));
                }}
              >
                {t("Show native identity for owner enrollment")}
              </Button>
            </div>
            {problem && <InlineError details={problem.details}>{problem.message}</InlineError>}
            {identity && (
              <div
                {...surfaceAttributes(
                  { variant: "card", frame: "card", radius: "card" },
                  styles.identity,
                )}
              >
                <Text as="p" tone="inherit" leading="inherit">
                  {t("Installation ID")}: <Code>{identity.installationId}</Code>
                </Text>
                <Text as="p" tone="inherit" leading="inherit">
                  {t("Fingerprint")}: <Code>{identity.fingerprint}</Code>
                </Text>
                <OutputBlock size="caption" tone="inherit" leading="inherit" frame="none">
                  {identity.publicKey}
                </OutputBlock>
              </div>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
