import { type FormEvent } from "react";
import { TextField } from "../../../shared/ui/TextField";
import { Button } from "../../../shared/ui/Button";
import { t, useLocale } from "../../../shared/i18n";
import { HARNESS_TITLE } from "../../sessions";
import { type ProviderAccountProvider } from "../../providers/public/providerAccounts";

export type AccountEditor = {
  provider: ProviderAccountProvider;
  accountId?: string;
  label: string;
};

export function ProviderAccountEditor({
  editor,
  working,
  onLabel,
  onCancel,
  onSubmit,
}: {
  editor: AccountEditor;
  working: boolean;
  onLabel: (label: string) => void;
  onCancel: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  useLocale();
  const adding = !editor.accountId;
  return (
    <form className="provider-account-editor" onSubmit={onSubmit}>
      <div data-provider-account-editor-field className="flex min-w-0 flex-1 items-center gap-1.5">
        <TextField
          label={t("Account name")}
          hideLabel
          autoFocus
          type="text"
          maxLength={48}
          value={editor.label}
          disabled={working}
          placeholder={t("Work or Personal")}
          aria-label={t(adding ? "New {p1} account" : "Rename {p1} account", {
            p1: HARNESS_TITLE[editor.provider],
          })}
          onChange={(event) => onLabel(event.target.value)}
          className="min-w-0 flex-1"
          fieldClassName="min-w-0 flex-1"
        />
        <Button className="shrink-0" disabled={working && !adding} onClick={onCancel}>
          {t("Cancel")}
        </Button>
        <Button
          reserveLabels={[t("Waiting for browser…"), t("Sign in and add")]}
          type="submit"
          variant="secondary"
          loading={working}
          disabled={working || !editor.label.trim()}
        >
          {adding ? (working ? t("Waiting for browser…") : t("Sign in and add")) : t("Save")}
        </Button>
      </div>
    </form>
  );
}
