import { useState, useSyncExternalStore, type FormEvent } from "react";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { ActionHost } from "../../../shared/ui/ActionHost";
import { Button } from "../../../shared/ui/Button";
import { DropdownMenu } from "../../../shared/ui/DropdownMenu";
import { Text } from "../../../shared/ui/Text";
import { AlertCircle, Briefcase, MoreHorizontal, UserRound } from "../../../shared/ui/icons";
import { t, useLocale } from "../../../shared/i18n";
import { HARNESS_TITLE } from "../../sessions";
import {
  saveSharedCliAccount,
  sharedCliAccount,
  subscribeProviderAccounts,
  type SharedCliAccount,
  type SharedCliAccountProvider,
} from "../../providers/public/providerAccounts";
import {
  getHarnessAvailabilitySnapshot,
  hasProbedHarnessAvailability,
  isHarnessAvailable,
  subscribeHarnessAvailability,
} from "../../../integrations/harness/core/availability";
import {
  AccountColorDot,
  AccountColorPopover,
  ProviderAccountSubtitle,
} from "../../providers/public/accountIdentity";
import { Group, SettingsFeedback } from "../../../shared/ui/settings";
import { ProviderAccountDialog, type AccountEditor } from "../../providers/public/accountIdentity";

/** Personal/Work tag shared by every account row. */
export function AccountKindTag({ tag, work }: { tag: string; work: boolean }) {
  return (
    <Text
      size="caption"
      tone="secondary"
      wrap="anywhere"
      className="inline-flex min-w-0 items-center gap-1"
    >
      {work ? (
        <Briefcase className="icon-xs shrink-0" aria-hidden />
      ) : (
        <UserRound className="icon-xs shrink-0" aria-hidden />
      )}
      {tag}
    </Text>
  );
}

/**
 * The one machine-wide sign-in of a CLI without account profiles, shown as
 * the same row as a profile account. Name, colour and kind are local labels.
 */
export function SharedCliAccountCard({
  provider,
  visible = true,
}: {
  provider: SharedCliAccountProvider;
  visible?: boolean;
}) {
  useLocale();
  const snapshot = useSyncExternalStore(subscribeProviderAccounts, () =>
    JSON.stringify(sharedCliAccount(provider)),
  );
  useSyncExternalStore(subscribeHarnessAvailability, getHarnessAvailabilitySnapshot);
  const account: SharedCliAccount = JSON.parse(snapshot);
  const label = account.label || HARNESS_TITLE[provider];
  const shown = { ...account, label };
  const [editor, setEditor] = useState<AccountEditor | null>(null);
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const [colorAnchor, setColorAnchor] = useState<HTMLElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const missing = hasProbedHarnessAvailability() && !isHarnessAvailable(provider);

  const save = (metadata: Partial<Pick<SharedCliAccount, "label" | "kind" | "color">>) => {
    try {
      saveSharedCliAccount({ provider, ...metadata });
      setError(null);
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save this account");
      return false;
    }
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editor?.kind || !editor.label.trim()) return;
    if (save({ label: editor.label, kind: editor.kind, color: editor.color })) setEditor(null);
  };

  return (
    <Group
      id={`shared-cli-account-${provider}`}
      layout="full"
      title={t("Accounts")}
      feedback={
        error && !editor ? <SettingsFeedback state="error">{error}</SettingsFeedback> : undefined
      }
    >
      <div
        data-settings-part="account-list"
        {...surfaceAttributes({ layout: "settings-account-list" }, "provider-accounts-body")}
      >
        <ActionHost
          variant="settings"
          className="provider-account-row"
          data-settings-part="account"
        >
          <AccountColorDot account={account} className="size-2.5" />
          <div className="provider-account-main">
            <div className="provider-account-identity">
              <Text
                as="span"
                size="secondary"
                tone="primary"
                weight="medium"
                leading="inherit"
                wrap="anywhere"
                className="provider-account-name"
              >
                {label}
              </Text>
            </div>
            <Text
              as="div"
              size="caption"
              tone="inherit"
              leading="inherit"
              className="provider-account-meta"
            >
              <ProviderAccountSubtitle
                identity={null}
                fallback={t("Shared CLI profile")}
                tone="secondary"
                wrap
              />
              {account.kind ? (
                <AccountKindTag
                  tag={account.kind === "work" ? t("Work") : t("Personal")}
                  work={account.kind === "work"}
                />
              ) : null}
            </Text>
          </div>
          {/* An empty status column would wrap the menu onto its own line at narrow widths. */}
          {missing ? (
            <div className="provider-account-status">
              <AlertCircle role="img" aria-label={t("Not installed")} tone="warning" className="icon-sm" />
            </div>
          ) : null}
          <div className="provider-account-actions">
            <Button
              size="sm"
              variant="ghost"
              iconOnly
              label={t("Actions for {p0}", { p0: label })}
              aria-haspopup="menu"
              aria-expanded={menu !== null}
              onClick={(event) => {
                const anchor = event.currentTarget;
                setMenu((current) => (current ? null : anchor));
              }}
            >
              <MoreHorizontal className="icon-md" strokeWidth={1.75} aria-hidden />
            </Button>
          </div>
        </ActionHost>
      </div>
      {menu ? (
        <DropdownMenu
          anchor={menu}
          label={t("Actions for {p0}", { p0: label })}
          items={[
            { kind: "item", id: "rename", label: t("Edit account") },
            { kind: "item", id: "color", label: t("Color…") },
          ]}
          onClose={() => setMenu(null)}
          onPick={(id) => {
            const anchor = menu;
            setMenu(null);
            if (id === "rename") {
              setError(null);
              setEditor({
                provider,
                accountId: account.id,
                label,
                color: account.color,
                kind: account.kind ?? "personal",
              });
            } else if (id === "color") setColorAnchor(anchor);
          }}
        />
      ) : null}
      {colorAnchor ? (
        <AccountColorPopover
          account={shown}
          anchor={colorAnchor}
          onDismiss={() => setColorAnchor(null)}
          onPick={(color) => void save({ color })}
        />
      ) : null}
      {visible && editor ? (
        <ProviderAccountDialog
          editor={editor}
          working={false}
          submitError={error ?? undefined}
          onLabel={(next) =>
            setEditor((current) => (current ? { ...current, label: next } : current))
          }
          onMetadata={(metadata) =>
            setEditor((current) => (current ? { ...current, ...metadata } : current))
          }
          onCancel={() => {
            setError(null);
            setEditor(null);
          }}
          onSubmit={submit}
        />
      ) : null}
    </Group>
  );
}
