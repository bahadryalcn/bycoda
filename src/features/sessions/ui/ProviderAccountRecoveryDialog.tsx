import { presentRemoteError } from "../../connections/public/remoteFailure";
import { Alert } from "../../../shared/ui/Alert";
import { Button } from "../../../shared/ui/Button";
import { useRef, useState } from "react";
import { useT } from "../../../shared/i18n";
import { Modal } from "../../../shared/ui/Modal";
import { PickerList } from "../../../shared/ui/picker";
import { Spinner } from "../../../shared/ui/Spinner";
import { type ProviderAccountProvider } from "../../providers/model/providerAccounts";
import { useProviderAccounts } from "../../providers/public/useProviderAccounts";
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
  const accounts = useProviderAccounts(provider);
  const [busy, setBusy] = useState(false);
  const [pendingAccount, setPendingAccount] = useState<string | null>(null);
  const selecting = useRef(false);
  const [problem, setProblem] = useState<string | null>(null);
  const select = (accountId: string) =>
    selectAccount(accountId, {
      onSelect,
      onClose,
      selecting,
      setPendingAccount,
      setBusy,
      setProblem,
      message: t("The account could not be changed. Try again."),
    });
  return (
    <Modal
      title={t("Continue with another account")}
      size="sm"
      onClose={onClose}
      footer={
        <Button variant="ghost" type="button" disabled={busy} onClick={onManage}>
          {t("Manage accounts")}
        </Button>
      }
    >
      <PickerList
        label={t("Accounts")}
        options={accounts.map((account) => ({
          value: account.id,
          title: account.label,
          icon: <AccountColorDot account={account} />,
          trailing: pendingAccount === account.id ? <Spinner aria-busy="true" /> : undefined,
        }))}
        value={null}
        disabled={busy}
        checkPlacement="none"
        emptyLabel={t("No accounts. Add an account to sign in.")}
        listHeight="standard"
        onChange={(accountId: string) => void select(accountId)}
      />
      {problem ? <Alert tone="danger">{problem}</Alert> : null}
    </Modal>
  );
}

type SelectAccountDeps = {
  onSelect: (accountId: string) => Promise<boolean>;
  onClose: () => void;
  selecting: { current: boolean };
  setPendingAccount: (accountId: string | null) => void;
  setBusy: (busy: boolean) => void;
  setProblem: (error: string | null) => void;
  message: string;
};

// Module level: the compiler cannot lower a try/finally inside a component.
async function selectAccount(accountId: string, deps: SelectAccountDeps) {
  const { onSelect, onClose, selecting, setPendingAccount, setBusy, setProblem, message } = deps;
  if (selecting.current) return;
  selecting.current = true;
  setPendingAccount(accountId);
  setBusy(true);
  setProblem(null);
  try {
    if (await onSelect(accountId)) onClose();
    else setProblem(message);
  } catch (reason) {
    setProblem(presentRemoteError(reason, { explicit: true }));
  } finally {
    selecting.current = false;
    setPendingAccount(null);
    setBusy(false);
  }
}
