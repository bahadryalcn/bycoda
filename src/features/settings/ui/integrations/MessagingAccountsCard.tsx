import { ActionHost } from "../../../../shared/ui/ActionHost";
import { surfaceAttributes } from "../../../../shared/ui/Surface";
import { useRef, useState, type ComponentType, type ReactNode } from "react";
import { t, useLocale } from "../../../../shared/i18n";
import { Badge } from "../../../../shared/ui/Badge";
import { Button } from "../../../../shared/ui/Button";
import { EmptyState } from "../../../../shared/ui/EmptyState";
import { LoadingText } from "../../../../shared/ui/LoadingText";
import { ScrollArea } from "../../../../shared/ui/ScrollArea";
import { Text } from "../../../../shared/ui/Text";
import { Plus } from "../../../../shared/ui/icons";
import { InboxAccountActions, InboxConnectionError } from "../InboxConnectionStatus";
import { Row, SettingsFeedback } from "../settingsControls";
import type { SaveInputResult } from "./emailPresets";
import {
  removeMessagingAccount,
  saveMessagingAccount,
  type MessagingAccount,
  type MessagingProvider,
} from "../../../messaging";
import { errorText } from "../../../../shared/lib/errors";
import { useMessagingAccounts } from "./useMessagingAccounts";

export type AccountFormProps = {
  /** The account being edited; null adds a new one. */
  account: MessagingAccount | null;
  onSaved: (account: MessagingAccount) => void;
  onSavingChange?: (saving: boolean) => void;
  /** Absent while the form is the only way to add the first account. */
  onCancel?: () => void;
};

/** Saved accounts of one provider plus the add/edit form. Drafts live in the mounted form. */
export function MessagingAccountsCard({
  provider,
  emptyLabel,
  addLabel,
  describe,
  Form,
}: {
  provider: MessagingProvider;
  emptyLabel: string;
  addLabel: string;
  describe: (account: MessagingAccount) => string;
  Form: ComponentType<AccountFormProps>;
}) {
  useLocale();
  const { accounts, loading, error, reload } = useMessagingAccounts(provider);
  const [editing, setEditing] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [saved, setSaved] = useState<MessagingAccount | null>(null);
  const [drafts, setDrafts] = useState<string[]>([]);
  const [saving, setSaving] = useState<string[]>([]);
  const empty = accounts !== null && accounts.length === 0;
  const target = accounts === null ? null : (editing ?? (empty ? "new" : null));
  const editAccount = accounts?.find((account) => account.id === target) ?? null;
  const formOpen = target === "new" || editAccount !== null;
  const open = (id: string) => {
    if (saving.length || removing) return;
    setDrafts((current) => (current.includes(id) ? current : [...current, id]));
    setEditing(id);
  };
  const close = (id: string) => {
    setDrafts((current) => current.filter((value) => value !== id));
    setEditing((current) => (current === id ? null : current));
  };

  const remove = async (account: MessagingAccount) => {
    if (removing || saving.length) return;
    setRemoving(account.id);
    setRemoveError(null);
    try {
      await removeMessagingAccount(account.id);
      setEditing((current) => (current === account.id ? null : current));
      setSaved((current) => (current?.id === account.id ? null : current));
    } catch (err: unknown) {
      setRemoveError(errorText(err));
    } finally {
      setRemoving(null);
    }
  };

  return (
    <>
      <Row
        stacked
        label={t("Accounts")}
        info={t("Credentials are stored on this computer. Disconnect removes them.")}
        feedback={
          error ? (
            <SettingsFeedback
              state="error"
              action={
                <Button
                  stableWidth
                  loading={loading}
                  onClick={() => {
                    reload().catch(() => undefined);
                  }}
                >
                  {t("Retry")}
                </Button>
              }
            >
              {error}
            </SettingsFeedback>
          ) : undefined
        }
      >
        {accounts === null ? (
          loading ? (
            <LoadingText />
          ) : null
        ) : empty ? (
          <EmptyState
            size="inline"
            {...surfaceAttributes(
              { variant: "card", frame: "settings", radius: "card" },
              "settings-collection settings-collection-empty",
            )}
            descriptionText={{ size: "caption", tone: "secondary", leading: "normal" }}
            description={emptyLabel}
          />
        ) : (
          <div
            {...surfaceAttributes(
              { variant: "card", frame: "settings", radius: "card" },
              "settings-collection",
            )}
          >
            <ScrollArea
              gutter="stable"
              {...surfaceAttributes({ separator: "block" }, "settings-collection-list")}
              role="list"
            >
              {accounts.map((account) => (
                <ActionHost
                  key={account.id}
                  role="listitem"
                  {...surfaceAttributes(
                    { radius: "none", separator: "block" },
                    "settings-collection-row",
                  )}
                >
                  <div className="settings-collection-main">
                    <Text
                      as="p"
                      size="secondary"
                      tone="primary"
                      weight="medium"
                      leading="normal"
                      truncate
                      className="settings-collection-title"
                    >
                      {account.label || account.identity}
                    </Text>
                    <Text as="p" leading="normal" className="settings-collection-meta">
                      {describe(account)}
                    </Text>
                  </div>
                  <div className="settings-collection-actions">
                    <Badge
                      size="sm"
                      appearance="subtle"
                      tone={account.connected ? "neutral" : "warning"}
                    >
                      {account.connected ? t("Configured") : t("Credentials missing")}
                    </Badge>
                    <Button
                      disabled={saving.length > 0 || removing !== null || target === account.id}
                      onClick={() => open(account.id)}
                    >
                      {t("Edit")}
                    </Button>
                    <InboxAccountActions
                      disabled={saving.length > 0 || removing !== null}
                      loading={removing === account.id}
                      onDisconnect={() => {
                        remove(account).catch(() => undefined);
                      }}
                    />
                  </div>
                </ActionHost>
              ))}
            </ScrollArea>
          </div>
        )}
        {accounts !== null && !empty && target !== "new" ? (
          <div className="integration-actions">
            <Button
              disabled={saving.length > 0 || removing !== null}
              startIcon={<Plus className="icon-sm" />}
              onClick={() => open("new")}
            >
              {addLabel}
            </Button>
          </div>
        ) : null}
      </Row>
      <InboxConnectionError error={removeError} />
      {saved && !formOpen ? (
        <SettingsFeedback state="success" onDismiss={() => setSaved(null)}>
          {t("Connected as {p0}.", { p0: saved.identity || saved.label })}
        </SettingsFeedback>
      ) : null}
      {[...new Set([...drafts, ...(formOpen && target ? [target] : [])])].map((id) => {
        const account = accounts?.find((item) => item.id === id) ?? null;
        if (id !== "new" && !account) return null;
        return (
          <div key={id} hidden={target !== id}>
            <Form
              account={account}
              onSavingChange={(pending) =>
                setSaving((current) =>
                  pending
                    ? [...new Set([...current, id])]
                    : current.filter((owner) => owner !== id),
                )
              }
              onSaved={(value) => {
                setSaved(value);
                close(id);
              }}
              onCancel={empty ? undefined : () => close(id)}
            />
          </div>
        );
      })}
    </>
  );
}

/** One in-flight save per form; a rejected draft stays for correction. */
export function useAccountSave(
  onSaved: (account: MessagingAccount) => void,
  onSavingChange?: (saving: boolean) => void,
) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const save = async (result: SaveInputResult) => {
    if (pending.current) return;
    if (!result.ok) {
      setError(result.error);
      return;
    }
    pending.current = true;
    setSaving(true);
    onSavingChange?.(true);
    setError(null);
    try {
      onSaved(await saveMessagingAccount(result.input));
    } catch (err: unknown) {
      setError(errorText(err));
    } finally {
      pending.current = false;
      setSaving(false);
      onSavingChange?.(false);
    }
  };
  return { saving, error, save };
}

/** Save/cancel actions and the inline error shared by every account form. */
export function AccountFormActions({
  saving,
  error,
  disabled = false,
  onSave,
  onCancel,
  children,
}: {
  saving: boolean;
  error: string | null;
  disabled?: boolean;
  onSave: () => void;
  onCancel?: () => void;
  /** Extra actions before Save, such as Microsoft sign-in. */
  children?: ReactNode;
}) {
  return (
    <>
      <div
        {...surfaceAttributes({ frame: "settings", edge: "block-start" }, "integration-actions")}
      >
        {children}
        <Button
          variant="primary"
          stableWidth
          reserveLabels={[t("Saving and testing…"), t("Retry save and test")]}
          loading={saving}
          disabled={disabled}
          onClick={onSave}
        >
          {saving
            ? t("Saving and testing…")
            : error
              ? t("Retry save and test")
              : t("Save and test connection")}
        </Button>
        {onCancel ? (
          <Button disabled={saving} onClick={onCancel}>
            {t("Cancel")}
          </Button>
        ) : null}
      </div>
      <InboxConnectionError error={error} />
    </>
  );
}
