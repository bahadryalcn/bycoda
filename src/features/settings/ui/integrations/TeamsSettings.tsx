import { useState } from "react";
import { t, useLocale } from "../../../../shared/i18n";
import { TextField } from "../../../../shared/ui/TextField";
import { AdvancedSettings, Row } from "../settingsControls";
import { teamsSaveInput } from "./chatAccountInputs";
import {
  AccountFormActions,
  MessagingAccountsCard,
  useAccountSave,
  type AccountFormProps,
} from "./MessagingAccountsCard";
import { MicrosoftDeviceSignIn } from "./MicrosoftDeviceSignIn";

export function TeamsSettings() {
  useLocale();
  return (
    <MessagingAccountsCard
      provider="teams"
      emptyLabel={t("No Microsoft Teams accounts connected yet.")}
      addLabel={t("Add account")}
      describe={(account) => account.identity || t("Microsoft Teams")}
      Form={TeamsAccountForm}
    />
  );
}

const configText = (value: unknown) => (typeof value === "string" ? value : "");

function TeamsAccountForm({ account, onSaved, onCancel, onSavingChange }: AccountFormProps) {
  useLocale();
  const [tenant, setTenant] = useState(() => configText(account?.config.tenant) || "common");
  const [clientId, setClientId] = useState(() => configText(account?.config.clientId));
  const [authHandle, setAuthHandle] = useState<string | null>(null);
  const { saving, error, save } = useAccountSave(onSaved, onSavingChange);
  const submit = (handle = authHandle ?? undefined) => {
    save(teamsSaveInput({ tenant, clientId }, { id: account?.id, authHandle: handle })).catch(
      () => undefined,
    );
  };
  return (
    <>
      <Row
        stacked
        label={account ? t("Edit Microsoft Teams account") : t("Connect Microsoft Teams")}
        info={t(
          "Sign in with the Microsoft work or school account whose chats you want to read and answer.",
        )}
        persistence={{ mode: "explicit", state: saving ? "saving" : authHandle ? "dirty" : "idle" }}
      >
        <div className="integration-fields">
          <TextField
            label={t("Tenant")}
            aria-label={t("Tenant")}
            value={tenant}
            onChange={(event) => setTenant(event.target.value)}
            placeholder="common"
            autoComplete="off"
            spellCheck={false}
            disabled={saving}
          />
        </div>
        <MicrosoftDeviceSignIn
          purpose="teams"
          clientId={clientId}
          tenant={tenant}
          signedIn={authHandle !== null || Boolean(account?.connected)}
          disabled={saving}
          onSignedIn={(handle) => {
            setAuthHandle(handle);
            submit(handle);
          }}
        />
      </Row>
      <AdvancedSettings defaultOpen={false} keepMounted>
        <Row
          stacked
          label={t("Microsoft app client ID")}
          info={t("Only needed when your organization requires its own app registration.")}
        >
          <TextField
            label={t("Microsoft app client ID")}
            hideLabel
            aria-label={t("Microsoft app client ID")}
            value={clientId}
            onChange={(event) => setClientId(event.target.value)}
            placeholder="00000000-0000-0000-0000-000000000000"
            autoComplete="off"
            spellCheck={false}
            monospace
            disabled={saving}
          />
        </Row>
      </AdvancedSettings>
      <AccountFormActions
        saving={saving}
        error={error}
        disabled={!account && authHandle === null}
        onSave={() => submit()}
        onCancel={onCancel}
      />
    </>
  );
}
