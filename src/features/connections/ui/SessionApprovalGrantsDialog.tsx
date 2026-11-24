import { useEffect, useRef, useState } from "react";
import { useStableCallback } from "../../../shared/hooks/useStableCallback";
import { useT } from "../../../shared/i18n";
import type { SessionApprovalGrant } from "../../../shared/model/sessionApprovalGrant";
import { Button } from "../../../shared/ui/Button";
import { InlineError } from "../../../shared/ui/InlineError";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { Modal } from "../../../shared/ui/Modal";
import { Text } from "../../../shared/ui/Text";

export function SessionApprovalGrantsDialog({
  request,
  onClose,
}: {
  request: (grantId?: string) => Promise<SessionApprovalGrant[]>;
  onClose: () => void;
}) {
  const t = useT();
  const [grants, setGrants] = useState<SessionApprovalGrant[]>();
  const [error, setError] = useState<"load" | "revoke">();
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const update = useStableCallback(async (grantId?: string) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(undefined);
    try {
      setGrants(await request(grantId));
    } catch {
      setError(grantId ? "revoke" : "load");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  });

  // Each opening reads the owning Host's current grants, including revocations from other clients.
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- loads Host-owned grants when the dialog opens, no query store owns them
  useEffect(() => {
    void update();
  }, [update]);

  return (
    <Modal title={t("Session approvals")} size="sm" onClose={onClose}>
      {busy && !grants ? <LoadingText delay={false}>{t("Loading…")}</LoadingText> : null}
      {grants?.length === 0 ? <Text>{t("No active session approvals")}</Text> : null}
      {grants?.map((grant) => (
        <div key={grant.id} className="flex flex-wrap items-center justify-between gap-2">
          <Text>{t("Workspace filename search")} (Claude Glob)</Text>
          <Button
            variant="secondary"
            size="sm"
            loading={busy}
            onClick={() => void update(grant.id)}
          >
            {t("Revoke")}
          </Button>
        </div>
      ))}
      {error ? (
        <InlineError retry={error === "load" ? { onRetry: () => void update() } : undefined}>
          {error === "load"
            ? t("Could not load session approvals")
            : t("Could not revoke the session approval")}
        </InlineError>
      ) : null}
    </Modal>
  );
}
