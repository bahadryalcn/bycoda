import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useRemoteMachines } from "../../connections/model/connections";
import { t } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Modal, ModalActions } from "../../../shared/ui/Modal";
import { Select } from "../../../shared/ui/Select";
import { TextField } from "../../../shared/ui/TextField";
import { InlineError } from "../../../shared/ui/InlineError";
import styles from "./AssistantView.module.css";

type NativeIdentity = { installationId: string; publicKey: string; fingerprint: string };
type RemoteDraft = { machineId:string; projectId:string; scope:string; duration:string };
const drafts = new Map<string, RemoteDraft>();
type OriginalRequest = { machineId:string; requestId:string };
const requestKey = (key:string) => `bycoda.room-delegation.request:${key}`;
function readRequest(key:string):OriginalRequest | undefined {
  try { const value = JSON.parse(localStorage.getItem(requestKey(key)) ?? "null") as OriginalRequest | null; return value && typeof value.machineId === "string" && typeof value.requestId === "string" ? value : undefined; }
  catch { return undefined; }
}
export function AssistantRemoteAccess({ threadId, environmentId, sourceStatus }: { threadId: string; environmentId?: string; sourceStatus: "pending" | "registered" | "unavailable" }) {
  const [open, setOpen] = useState(false);
  const draftKey=JSON.stringify([environmentId,threadId]);
  const [machineId, setMachineId] = useState(() => drafts.get(draftKey)?.machineId ?? "");
  const [projectId, setProjectId] = useState(() => drafts.get(draftKey)?.projectId ?? "");
  const [scope, setScope] = useState(() => drafts.get(draftKey)?.scope ?? "read");
  const [duration, setDuration] = useState(() => drafts.get(draftKey)?.duration ?? "1");
  useEffect(() => { drafts.set(draftKey,{machineId,projectId,scope,duration}); },[draftKey,machineId,projectId,scope,duration]);
  const [identity, setIdentity] = useState<NativeIdentity>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [request, setRequest] = useState(() => readRequest(draftKey));
  const [result, setResult] = useState("");
  const [retainedGrant, setRetainedGrant] = useState("");
  const { machines, loading, error: machinesError } = useRemoteMachines(open);
  const targets = machines.filter(machine => machine.environmentId && machine.environmentId !== environmentId);
  async function showIdentity() {
    setPending(true); setError("");
    try { setIdentity(await invoke<NativeIdentity>("room_delegation_native_identity")); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setPending(false); }
  }
  async function connect() {
    if (!machineId || !projectId.trim() || request) return;
    const original = { machineId, requestId: crypto.randomUUID() };
    try { localStorage.setItem(requestKey(draftKey), JSON.stringify(original)); }
    catch { setError(t("Cannot retain the original request. Connection was not started.")); return; }
    setRequest(original); setPending(true); setError(""); setResult("");
    const actions = ["sessions.list", "sessions.read", "tasks.list", "tasks.get", ...(scope === "manage" ? ["tasks.create", "tasks.update"] : [])];
    try {
      const grant = await invoke<{grantId:string;expiresAt:number}>("room_delegation_issue", { machineId, threadId, projectId:projectId.trim(), actions, expiresAt:Date.now()+Number(duration)*60*60*1000, requestId:original.requestId });
      setResult(`${t("Grant issued")}: ${grant.grantId}`);
      localStorage.removeItem(requestKey(draftKey)); setRequest(undefined);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      if (message === "Room delegation cancelled") { localStorage.removeItem(requestKey(draftKey)); setRequest(undefined); }
      setError(message);
    }
    finally { setPending(false); }
  }
  async function inspect() {
    if (!request) return;
    setPending(true); setError("");
    try {
      const status = await invoke<{state:string;result?:{grantId?:string}}>("room_delegation_issue_status", { machineId:request.machineId, threadId, requestId:request.requestId });
      setRetainedGrant(status.result?.grantId ?? "");
      setResult(`${t("Original request")}: ${status.state}${status.result?.grantId ? ` (${status.result.grantId})` : ""}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setPending(false); }
  }
  async function revokeRetained() {
    if (!request || !retainedGrant) return;
    setPending(true); setError("");
    try {
      await invoke("room_delegation_revoke_retained", { machineId:request.machineId, threadId, grantId:retainedGrant });
      localStorage.removeItem(requestKey(draftKey)); setRequest(undefined); setRetainedGrant(""); setResult(t("Original grant revoked."));
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setPending(false); }
  }
  return <>
    <Button variant="ghost" onClick={() => setOpen(true)} disabled={!threadId || !environmentId}>{t("Remote access")}</Button>
    {open && <Modal title={t("Remote Room access")} size="md" onClose={() => setOpen(false)} footer={<ModalActions><Button onClick={() => setOpen(false)}>{t("Close")}</Button><Button variant="primary" loading={pending} disabled={pending || !!request || sourceStatus !== "registered" || !machineId || !projectId.trim()} onClick={() => { void connect().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause))); }}>{t("Connect")}</Button></ModalActions>}>
      <div className={styles.setup}>
        <p className={styles.muted}>{sourceStatus === "registered" ? t("This Room is registered on its original Host.") : sourceStatus === "unavailable" ? t("Room registration is unavailable. Reopen the Room to retry.") : t("Checking Room registration…")}</p>
        <Select visibleLabel label={t("Paired Host")} value={machineId} onValueChange={setMachineId} disabled={loading || !targets.length} options={[{value:"",label:t("Choose a paired Host"),disabled:true},...targets.map(machine => ({ value: machine.id, label: `${machine.name} (${machine.environmentId})` }))]} />
        {machinesError && <InlineError>{machinesError}</InlineError>}
        {!loading && !targets.length && <p className={styles.muted}>{t("No other paired Host is available.")}</p>}
        <TextField label={t("Target project ID")} value={projectId} onChange={event => setProjectId(event.currentTarget.value)} />
        <Select visibleLabel label={t("Scope")} value={scope} onValueChange={setScope} options={[{value:"read",label:t("Read conversations and tasks")},{value:"manage",label:t("Read and manage tasks")}]} />
        <Select visibleLabel label={t("Duration")} value={duration} onValueChange={setDuration} options={[{value:"1",label:t("1 hour")},{value:"24",label:t("24 hours")}]} />
        <p className={styles.muted}>{t("The target project must be visible and the native identity trusted by both Hosts. Each connection requires native review.")}</p>
        {request && <><p className={styles.muted}>{t("Inspect the original request before starting another connection.")} <code>{request.requestId}</code></p><Button disabled={pending} onClick={() => { void inspect().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause))); }}>{t("Inspect request")}</Button></>}
        {request && retainedGrant && <Button disabled={pending} onClick={() => { void revokeRetained().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause))); }}>{t("Revoke original grant")}</Button>}
        {result && <p>{result}</p>}
        <Button variant="ghost" loading={pending} disabled={pending} onClick={() => { void showIdentity().catch(cause => setError(cause instanceof Error ? cause.message : String(cause))); }}>{t("Show native identity for owner enrollment")}</Button>
        {error && <InlineError>{error}</InlineError>}
        {identity && <div><p>{t("Installation ID")}: <code>{identity.installationId}</code></p><p>{t("Fingerprint")}: <code>{identity.fingerprint}</code></p><pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{identity.publicKey}</pre></div>}
      </div>
    </Modal>}
  </>;
}
