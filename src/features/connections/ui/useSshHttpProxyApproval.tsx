import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { t } from "../../../shared/i18n";
import { Modal } from "../../../shared/ui/Modal";
import { Button } from "../../../shared/ui/Button";
import { TextField } from "../../../shared/ui/TextField";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { Alert } from "../../../shared/ui/Alert";
import { sshEndpointPreview } from "../model/sshEndpointReview";
import {
  approveSshHttpProxy,
  revokeSshHttpProxyApproval,
  validHttpProxyCredentials,
  type SshHttpProxyRequest,
} from "../model/sshHttpProxyApproval";

function ProxyApprovalDialog({
  request,
  onResult,
}: {
  request: SshHttpProxyRequest;
  onResult: (value: string | undefined | null) => void;
}) {
  const secure = request.endpoint.httpProxy?.scheme === "https";
  const [mode, setMode] = useState("anonymous"),
    [consent, setConsent] = useState(false),
    [valid, setValid] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const username = useRef<HTMLInputElement>(null),
    password = useRef<HTMLInputElement>(null);
  const mounted = useRef(true),
    locked = useRef(false),
    settled = useRef(false);
  const clear = () => {
    if (username.current) username.current.value = "";
    if (password.current) password.current.value = "";
    setValid(false);
  };
  useLayoutEffect(() => {
    const userInput = username.current,
      passwordInput = password.current;
    return () => {
      if (userInput) userInput.value = "";
      if (passwordInput) passwordInput.value = "";
    };
  }, [mode]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const change = () =>
    setValid(
      validHttpProxyCredentials(username.current?.value ?? "", password.current?.value ?? ""),
    );
  const finish = (value: string | undefined | null) => {
    settled.current = true;
    clear();
    onResult(value);
  };
  return (
    <Modal title={t("HTTP proxy authentication")} onClose={() => finish(null)} size="sm">
      <div className="flex min-w-0 flex-col gap-3 p-4">
        <div className="text-xs">
          <p className="break-all font-medium">
            {secure ? "HTTPS CONNECT" : "HTTP CONNECT"}:{" "}
            {sshEndpointPreview(request.endpoint.httpProxy!)}
          </p>
          <p className="mbs-1 break-all text-(--ui-text-muted)">
            {t("SSH target")}: {sshEndpointPreview(request.endpoint)}
          </p>
          <p className="mbs-1 text-(--ui-text-muted)">
            {t(
              {
                terminal: "Terminal",
                runbook: "SSH runbooks",
                forward: "Port forwarding",
                sftpList: "List directory",
                sftpDownload: "Download",
                sftpUpload: "Upload",
                sftpResume: "Resume",
                sftpDiscard: "Discard partial",
              }[request.operation.kind],
            )}
          </p>
          {request.operation.kind === "runbook" ? (
            <p className="mbs-1 break-all">
              {request.operation.automationId} · r{request.operation.revision} ·{" "}
              {request.operation.serverId}
            </p>
          ) : null}
          {request.operation.kind === "sftpList" ? (
            <p className="mbs-1 break-all">{request.operation.path}</p>
          ) : null}
          {request.operation.kind === "sftpDownload" || request.operation.kind === "sftpUpload" ? (
            <p className="mbs-1 break-all">
              {request.operation.localPath} ↔ {request.operation.remotePath}
            </p>
          ) : null}
          {request.operation.kind === "forward" ? (
            <p className="mbs-1 break-all">
              127.0.0.1:{request.operation.localPort}
              {request.operation.forwardKind === "local"
                ? ` → ${request.operation.targetHost}:${request.operation.targetPort}`
                : " · SOCKS5"}
            </p>
          ) : null}
        </div>
        <SegmentedControl
          label={t("Proxy authentication")}
          value={mode}
          onValueChange={(value) => {
            if (busy) return;
            clear();
            setConsent(false);
            setMode(value);
            setError("");
          }}
          options={[
            { value: "anonymous", label: t("No authentication") },
            { value: "basic", label: "Basic" },
          ]}
        />
        {error ? (
          <Alert role="alert" tone="danger">
            {error}
          </Alert>
        ) : null}
        {mode === "basic" ? (
          <>
            <TextField
              label={t("Proxy username")}
              ref={username}
              defaultValue=""
              autoComplete="off"
              disabled={busy}
              onChange={change}
            />
            <TextField
              label={t("Proxy password")}
              type="password"
              ref={password}
              defaultValue=""
              autoComplete="off"
              disabled={busy}
              onChange={change}
            />
            <label className="flex items-start gap-2 text-xs">
              <Checkbox
                checked={consent}
                disabled={busy}
                onChange={(event) => setConsent(event.target.checked)}
              />
              {t(
                secure
                  ? "I approve these Basic credentials for this TLS-verified HTTPS proxy and this operation."
                  : "I allow sending these Basic credentials to this HTTP proxy without TLS for this operation.",
              )}
            </label>
            <p className="text-xs text-(--ui-text-muted)">
              {t(
                "SSH traffic remains encrypted after CONNECT. Proxy credentials are temporary and never saved; another operation needs a new approval.",
              )}
            </p>
          </>
        ) : (
          <p className="text-xs text-(--ui-text-muted)">
            {t(
              "Continue without credentials. A proxy authentication error will not retry automatically.",
            )}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <Button disabled={busy} onClick={() => finish(null)}>
            {t("Cancel")}
          </Button>
          <Button
            variant="primary"
            label={
              mode === "basic" ? t("Approve this operation") : t("Continue without authentication")
            }
            disabled={busy || (mode === "basic" && (!consent || !valid))}
            onClick={() => {
              if (locked.current) return;
              if (mode === "anonymous") {
                finish(undefined);
                return;
              }
              if (!consent || !valid || !username.current || !password.current) return;
              locked.current = true;
              setBusy(true);
              setError("");
              void approveSshHttpProxy(
                request,
                username.current.value,
                password.current.value,
                !secure,
              )
                .then((approval) => {
                  if (mounted.current && !settled.current) finish(approval.ticketId);
                  else void revokeSshHttpProxyApproval(approval.ticketId).catch(() => {});
                })
                .catch((reason) => {
                  if (mounted.current) setError(String(reason));
                })
                .finally(() => {
                  locked.current = false;
                  if (mounted.current) {
                    clear();
                    setBusy(false);
                  }
                });
            }}
          >
            {mode === "basic" ? t("Approve this operation") : t("Continue without authentication")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
/** Session-only prompt. `undefined` means anonymous; `null` cancels the operation. */
export function useSshHttpProxyApproval() {
  const [pending, setPending] = useState<{ id: number; request: SshHttpProxyRequest }>();
  const sequence = useRef(0),
    resolver = useRef<
      { id: number; resolve: (value: string | undefined | null) => void } | undefined
    >(undefined),
    mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const current = resolver.current;
      resolver.current = undefined;
      current?.resolve(null);
    };
  }, []);
  const request = useCallback((input: SshHttpProxyRequest): Promise<string | undefined | null> => {
    if (!input.endpoint.httpProxy) return Promise.resolve(undefined);
    if (!mounted.current || resolver.current) return Promise.resolve(null);
    return new Promise((resolve) => {
      const id = ++sequence.current;
      resolver.current = { id, resolve };
      setPending({ id, request: structuredClone(input) });
    });
  }, []);
  const finish = useCallback((id: number, value: string | undefined | null) => {
    const current = resolver.current;
    if (current?.id !== id) {
      if (typeof value === "string") void revokeSshHttpProxyApproval(value).catch(() => {});
      return;
    }
    resolver.current = undefined;
    setPending(undefined);
    current.resolve(value);
  }, []);
  return {
    request,
    dialog: pending ? (
      <ProxyApprovalDialog
        key={pending.id}
        request={pending.request}
        onResult={(value) => finish(pending.id, value)}
      />
    ) : null,
  };
}
