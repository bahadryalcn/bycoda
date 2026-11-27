import { useEffect, useId, type ComponentProps, type FormEvent } from "react";
import { TextField } from "../../../shared/ui/TextField";
import { Button } from "../../../shared/ui/Button";
import { Modal, ModalFooter, ModalActions } from "../../../shared/ui/Modal";
import { InlineError } from "../../../shared/ui/InlineError";
import { RadioGroup } from "../../../shared/ui/RadioGroup";
import { Text } from "../../../shared/ui/Text";
import { UserRound, Briefcase } from "../../../shared/ui/icons";
import { t, useLocale } from "../../../shared/i18n";
import { HARNESS_TITLE } from "../../sessions";
import { HarnessIcon } from "../../sessions/public/HarnessIcon";
import { ProviderAccountSubtitle } from "./ProviderAccountSubtitle";
import type { ProviderAccountIdentity } from "../model/providerAccountIdentity";
import { AccountColorPicker } from "./AccountColorPicker";
import type {
  ProviderAccountProvider,
  ProviderAccountColor,
  SharedCliAccountProvider,
} from "../model/providerAccounts";

export type AccountEditor = {
  provider: ProviderAccountProvider | SharedCliAccountProvider;
  accountId: string;
  adding?: boolean;
  /** An account already signed in on this computer: adding it names it, never signs in. */
  existing?: { identity: ProviderAccountIdentity | null };
  label: string;
  color?: ProviderAccountColor;
  kind?: "personal" | "work";
};

export function ProviderAccountDialog(props: ComponentProps<typeof ProviderAccountEditor>) {
  useLocale();
  return (
    <Modal
      size="sm"
      title={
        props.editor.existing
          ? t("Add existing account")
          : props.editor.adding
            ? t("Add account")
            : t("Edit account")
      }
      initialFocus='input[type="text"]'
      onClose={props.onCancel}
      closeDisabled={props.working && !props.editor.adding}
    >
      <ProviderAccountEditor {...props} />
    </Modal>
  );
}

export function ProviderAccountEditor({
  editor,
  working,
  identity,
  submitError,
  existingLabels = [],
  onLabel,
  onMetadata,
  onCancel,
  onSubmit,
}: {
  editor: AccountEditor;
  working: boolean;
  identity?: ProviderAccountIdentity | null;
  submitError?: string;
  existingLabels?: string[];
  onLabel: (label: string) => void;
  onMetadata?: (metadata: Partial<Pick<AccountEditor, "kind" | "color">>) => void;
  onCancel: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  useLocale();
  const formId = useId();
  const { adding } = editor;
  const duplicate = existingLabels.some(
    (label) => label.trim().toLocaleLowerCase() === editor.label.trim().toLocaleLowerCase(),
  );
  const error = !editor.label.trim()
    ? t("Enter an account name")
    : duplicate
      ? t("An account with this name already exists")
      : undefined;
  const incomplete = Boolean(error);
  // Kind defaults to Personal, so a new account never waits on an extra choice.
  const needsDefaultKind = Boolean(onMetadata) && !editor.kind;
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- syncs the visible Personal default to the caller's draft before it can submit
  useEffect(() => {
    if (needsDefaultKind) onMetadata?.({ kind: "personal" });
  }, [needsDefaultKind, onMetadata]);
  const actions = (
    <ModalActions>
      <Button
        variant="ghost"
        disabled={working && !adding}
        disabledReason={t("Wait for the sign-in to finish.")}
        onClick={onCancel}
      >
        {t("Cancel")}
      </Button>
      <Button
        type="submit"
        form={formId}
        variant="primary"
        tone="accent"
        loading={working}
        loadingLabel={adding && !editor.existing ? t("Waiting for browser…") : undefined}
        disabled={working || incomplete}
        disabledReason={error}
      >
        {editor.existing ? t("Add") : adding ? t("Sign in and add") : t("Save")}
      </Button>
    </ModalActions>
  );
  return (
    <form
      id={formId}
      className="flex min-w-0 flex-col gap-3"
      onSubmit={(event) => {
        if (working || incomplete) {
          event.preventDefault();
          return;
        }
        onSubmit(event);
      }}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <HarnessIcon harness={editor.provider} className="icon-md shrink-0" />
        <Text size="caption" tone="secondary">
          {HARNESS_TITLE[editor.provider]}
        </Text>
        <ProviderAccountSubtitle identity={identity} size="caption" tone="secondary" wrap />
      </div>
      <TextField
        label={t("Account name")}
        autoFocus
        type="text"
        maxLength={48}
        value={editor.label}
        disabled={working}
        placeholder={t("Work or Personal")}
        error={adding && editor.label === "" ? undefined : error}
        onChange={(event) => onLabel(event.target.value)}
        fieldClassName="min-w-0 flex-1"
      />
      {onMetadata ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <RadioGroup
              variant="inline"
              label={t("Kind")}
              value={editor.kind ?? "personal"}
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
              onValueChange={(kind) => {
                if (kind === "personal" || kind === "work") onMetadata({ kind });
              }}
            />
          </div>
          <div className="flex items-center">
            <AccountColorPicker
              account={{
                provider: editor.provider,
                id: editor.accountId,
                label: editor.label.trim() || HARNESS_TITLE[editor.provider],
                color: editor.color,
              }}
              disabled={working}
              onPick={(color) => onMetadata({ color })}
            />
          </div>
        </>
      ) : null}
      {submitError ? (
        <InlineError details={submitError}>{t("Could not save this account.")}</InlineError>
      ) : null}
      <ModalFooter>{actions}</ModalFooter>
    </form>
  );
}
