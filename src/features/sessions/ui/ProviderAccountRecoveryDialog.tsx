import { useEffect, useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
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
  useLocale();
  const [, refresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => subscribeProviderAccounts(() => refresh((n) => n + 1)), []);
  const select = async (accountId: string) => {
    setBusy(true);
    setError(null);
    try {
      if (await onSelect(accountId)) onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={t("Continue with another account")} size="sm" onClose={onClose}>
      <div className="space-y-2">
        {providerAccounts(provider).map((account) => (
          <button
            key={account.id}
            type="button"
            disabled={busy}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left hover:bg-selection disabled:opacity-50"
            onClick={() => void select(account.id)}
          >
            <AccountColorDot account={account} />
            <span>{account.label}</span>
          </button>
        ))}
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        <button
          type="button"
          disabled={busy}
          className="text-sm text-content/70 hover:text-content"
          onClick={onManage}
        >
          {t("Accounts")}
        </button>
      </div>
    </Modal>
  );
}
