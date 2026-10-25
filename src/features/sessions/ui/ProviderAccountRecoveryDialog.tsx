import { Alert } from "../../../shared/ui/Alert";
import { Button } from "../../../shared/ui/Button";
import { useEffect, useRef, useState } from "react";
import { useT } from "../../../shared/i18n";
import { Modal } from "../../../shared/ui/Modal";
import {
  providerAccounts,
  subscribeProviderAccounts,
  type ProviderAccountProvider,
} from "../../providers/model/providerAccounts";
import { AccountColorDot } from "../../providers/ui/AccountColorDot";

/** Recover an existing conversation without silently choosing a different identity. */
export function ProviderAccountRecoveryDialog({
  provider,
  onSelect,
  onManage,
  onClose,
}: {
  provider: ProviderAccountProvider;
  onSelect: (accountId: string) => Promise<boolean>;
  onManage: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const [, refresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [pendingAccount, setPendingAccount] = useState<string | null>(null);
  const selecting = useRef(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => subscribeProviderAccounts(() => refresh((n) => n + 1)), []);
  const select = async (accountId: string) => {
    if (selecting.current) return;
    selecting.current = true;
    setPendingAccount(accountId);
    setBusy(true);
    setError(null);
    try {
      if (await onSelect(accountId)) onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      selecting.current = false;
      setPendingAccount(null);
      setBusy(false);
    }
  };
  return (
    <Modal title={t("Continue with another account")} size="sm" onClose={onClose}>
      <div className="space-y-2">
        {providerAccounts(provider).map((account) => (
          <Button
            fullWidth
            variant="item"
            key={account.id}
            type="button"
            disabled={busy}
            loading={pendingAccount === account.id}
            className="w-full text-left"
            onClick={() => void select(account.id)}
          >
            <AccountColorDot account={account} />
            <span>{account.label}</span>
          </Button>
        ))}
        {error ? (
          <Alert tone="danger" role="alert">
            {error}
          </Alert>
        ) : null}
        <Button
          variant="ghost"
          type="button"
          disabled={busy}

          onClick={onManage}
        >
          {t("Accounts")}
        </Button>
      </div>
    </Modal>
  );
}
