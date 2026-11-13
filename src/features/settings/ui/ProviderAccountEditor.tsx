import { useId, type FormEvent } from "react";
import { TextField } from "../../../shared/ui/TextField";
import { Button } from "../../../shared/ui/Button";
import { ModalFooter, ModalActions } from "../../../shared/ui/Modal";
import { RadioGroup } from "../../../shared/ui/RadioGroup";
import { Text } from "../../../shared/ui/Text";
import { UserRound, Briefcase } from "../../../shared/ui/icons";
import { t, useLocale } from "../../../shared/i18n";
import { HARNESS_TITLE } from "../../sessions";
import { HarnessIcon } from "../../sessions/public/HarnessIcon";
import { ProviderAccountSubtitle } from "../../providers/public/accountIdentity";
import type { ProviderAccountIdentity } from "../../providers/public/accountIdentity";
import { AccountColorPicker } from "../../providers/public/accountIdentity";
import type {
  ProviderAccountProvider,
  ProviderAccountColor,
} from "../../providers/public/providerAccounts";

export type AccountEditor = {
  provider: ProviderAccountProvider;
  accountId?: string;
  label: string;
  color?: ProviderAccountColor;
  kind?: "personal" | "work";
};

export function ProviderAccountEditor({
  editor,
  working,
  identity,
  existingLabels = [],
  onLabel,
  onMetadata,
  onCancel,
  onSubmit,
}: {
  editor: AccountEditor;
  working: boolean;
  identity?: ProviderAccountIdentity | null;
  existingLabels?: string[];
  onLabel: (label: string) => void;
  onMetadata?: (metadata: Partial<AccountEditor>) => void;
  onCancel: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  useLocale();
  const formId = useId();
  const adding = !editor.accountId;
  const duplicate = existingLabels.some(
    (label) => label.trim().toLocaleLowerCase() === editor.label.trim().toLocaleLowerCase(),
  );
  const error = !editor.label.trim()
    ? t("Enter an account name")
    : duplicate
      ? t("An account with this name already exists")
      : undefined;
  const actions = (
    <ModalActions inline={adding}>
      <Button variant="ghost" disabled={working && !adding} onClick={onCancel}>
        {t("Cancel")}
      </Button>
      <Button
        type="submit"
        form={formId}
        variant="primary"
        tone="accent"
        loading={working}
        disabled={working || Boolean(error)}
        reserveLabels={adding ? [t("Waiting for browser…"), t("Sign in and add")] : undefined}
      >
        {adding ? (working ? t("Waiting for browser…") : t("Sign in and add")) : t("Save")}
      </Button>
    </ModalActions>
  );
  return (
    <form
      id={formId}
      className={adding ? "provider-account-editor" : "provider-account-dialog-editor"}
      data-settings-part={adding ? "account-editor" : undefined}
      onSubmit={(event) => {
        if (error) {
          event.preventDefault();
          return;
        }
        onSubmit(event);
      }}
    >
      {!adding ? (
        <div className="flex min-w-0 items-center gap-2">
          <HarnessIcon harness={editor.provider} className="icon-md shrink-0" />
          <Text size="caption" tone="secondary">
            {HARNESS_TITLE[editor.provider]}
          </Text>
          <ProviderAccountSubtitle identity={identity} size="caption" tone="secondary" truncate />
        </div>
      ) : null}
      <TextField
        label={t("Account name")}
        hideLabel={adding}
        autoFocus
        type="text"
        maxLength={48}
        value={editor.label}
        disabled={working}
        placeholder={t("Work or Personal")}
        error={!adding ? error : undefined}
        aria-label={t(adding ? "New {p1} account" : "Rename {p1} account", {
          p1: HARNESS_TITLE[editor.provider],
        })}
        onChange={(event) => onLabel(event.target.value)}
        fieldClassName="min-w-0 flex-1"
      />
      {!adding && onMetadata ? (
        <>
          <Text size="secondary" weight="medium">
            {t("Kind")}
          </Text>
          <div className="flex flex-wrap items-center gap-2">
            <RadioGroup
              variant="inline"
              label={t("Kind")}
              value={editor.kind ?? ""}
              options={[
                {
                  value: "personal",
                  label: (
                    <span className="inline-flex items-center gap-1.5">
                      <UserRound className="icon-sm" aria-hidden />
                      {t("Personal")}
                    </span>
                  ),
                  disabled: working,
                },
                {
                  value: "work",
                  label: (
                    <span className="inline-flex items-center gap-1.5">
                      <Briefcase className="icon-sm" aria-hidden />
                      {t("Work")}
                    </span>
                  ),
                  disabled: working,
                },
              ]}
              onValueChange={(kind) => onMetadata({ kind: kind as "personal" | "work" })}
            />
            <Button
              size="sm"
              variant="ghost"
              pressed={!editor.kind}
              disabled={working || !editor.kind}
              onClick={() => onMetadata({ kind: undefined })}
            >
              {t("Automatic")}
            </Button>
          </div>
          <div className="flex items-center">
            <AccountColorPicker
              account={{
                provider: editor.provider,
                id: editor.accountId!,
                label: editor.label,
                color: editor.color,
                isDefault: false,
              }}
              disabled={working}
              onPick={(color) => onMetadata({ color })}
            />
          </div>
        </>
      ) : null}
      {adding ? actions : <ModalFooter>{actions}</ModalFooter>}
    </form>
  );
}
