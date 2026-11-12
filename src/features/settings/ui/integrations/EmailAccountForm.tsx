import { Text } from "../../../../shared/ui/Text";
import { useState } from "react";
import { t, useLocale } from "../../../../shared/i18n";
import { openExternal } from "../../../../platform/tauri/openExternal";
import { Button } from "../../../../shared/ui/Button";
import { InfoPopover } from "../../../../shared/ui/InfoPopover";
import { PasswordField } from "../../../../shared/ui/PasswordField";
import { Select } from "../../../../shared/ui/Select";
import { TextField } from "../../../../shared/ui/TextField";
import { ExternalLink } from "../../../../shared/ui/icons";
import { AdvancedSettings, Row, Toggle } from "../settingsControls";
import {
  APP_PASSWORD_PAGES,
  applyEmailPreset,
  emailPresetChoices,
  emailDraftFromAccount,
  emailPresetLabel,
  emailSaveInput,
  type EmailDraft,
} from "./emailPresets";
import { AccountFormActions, useAccountSave, type AccountFormProps } from "./MessagingAccountsCard";
import { BrowserSignIn } from "./BrowserSignIn";
import { MicrosoftDeviceSignIn } from "./MicrosoftDeviceSignIn";
import type { MailSecurity } from "../../../messaging";

const SECURITY_OPTIONS = [
  { value: "tls", label: "SSL/TLS" },
  { value: "starttls", label: "STARTTLS" },
];

export function EmailAccountForm({ account, onSaved, onCancel }: AccountFormProps) {
  useLocale();
  const [initial] = useState(() => emailDraftFromAccount(account));
  const [draft, setDraft] = useState(initial);
  const [authHandle, setAuthHandle] = useState<string | null>(null);
  /** Google client secret for a custom app registration: sent when sign-in starts, never saved. */
  const [clientSecret, setClientSecret] = useState("");
  const { saving, error, save } = useAccountSave(onSaved);
  const set = <K extends keyof EmailDraft>(key: K, value: EmailDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const microsoft = draft.auth === "microsoft";
  const google = draft.auth === "google";
  /** Gmail offers browser sign-in with an app password as the fallback. */
  const googleChoice = draft.preset === "gmail";
  /** The saved account already holds tokens for the selected sign-in. */
  const savedSignIn = Boolean(account?.connected) && account?.config.auth === draft.auth;
  const signedIn = authHandle !== null || savedSignIn;
  const dirty = authHandle !== null || JSON.stringify(draft) !== JSON.stringify(initial);
  const appPasswordPage = APP_PASSWORD_PAGES[draft.preset];

  const submit = (handle = authHandle ?? undefined) => {
    save(emailSaveInput(draft, { id: account?.id, authHandle: handle })).catch(() => undefined);
  };

  const field = (
    key: "imapHost" | "smtpHost" | "username" | "clientId",
    label: string,
    placeholder?: string,
    /** The row label already names the field; keep the label for assistive technology only. */
    hideLabel = false,
  ) => (
    <TextField
      label={label}
      hideLabel={hideLabel}
      aria-label={label}
      value={draft[key]}
      placeholder={placeholder}
      onChange={(event) => set(key, event.target.value)}
      autoComplete="off"
      spellCheck={false}
      monospace={key === "clientId"}
      disabled={saving}
    />
  );
  const server = (kind: "imap" | "smtp") => {
    const portKey = kind === "imap" ? "imapPort" : "smtpPort";
    const securityKey = kind === "imap" ? "imapSecurity" : "smtpSecurity";
    const portLabel = kind === "imap" ? t("IMAP port") : t("SMTP port");
    const securityLabel = kind === "imap" ? t("IMAP security") : t("SMTP security");
    return (
      <Row stacked label={kind === "imap" ? t("Incoming mail (IMAP)") : t("Outgoing mail (SMTP)")}>
        <div className="integration-fields" data-layout="server">
          {field(
            kind === "imap" ? "imapHost" : "smtpHost",
            kind === "imap" ? t("IMAP server") : t("SMTP server"),
            kind === "imap" ? "imap.example.com" : "smtp.example.com",
          )}
          <TextField
            label={portLabel}
            aria-label={portLabel}
            numeric
            value={draft[portKey]}
            onChange={(event) => set(portKey, event.target.value)}
            disabled={saving}
          />
          <Select
            label={securityLabel}
            value={draft[securityKey]}
            options={SECURITY_OPTIONS}
            onValueChange={(value) => set(securityKey, value as MailSecurity)}
            disabled={saving}
          />
        </div>
      </Row>
    );
  };
  const serverRows = (
    <>
      {googleChoice ? (
        <Row
          label={t("Use an app password instead")}
          info={t(
            "Sign in with an app password when browser sign-in is not available for your account.",
          )}
        >
          <Toggle
            label={t("Use an app password instead")}
            on={draft.auth === "password"}
            onChange={(on) => set("auth", on ? "password" : "google")}
            disabled={saving}
          />
        </Row>
      ) : null}
      {google ? (
        <>
          <Row
            stacked
            label={t("Google app client ID")}
            info={t("Only needed when you use your own Google Cloud OAuth client.")}
          >
            {field("clientId", t("Google app client ID"), "…apps.googleusercontent.com", true)}
          </Row>
          <Row
            stacked
            label={t("Google client secret")}
            info={t("Used only when sign-in starts and never saved.")}
          >
            <PasswordField
              label={t("Google client secret")}
              hideLabel
              aria-label={t("Google client secret")}
              value={clientSecret}
              onChange={(event) => setClientSecret(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              disabled={saving}
            />
          </Row>
        </>
      ) : null}
      {server("imap")}
      {server("smtp")}
      <Row stacked label={t("Username")} info={t("Leave empty to sign in with the email address.")}>
        {field("username", t("Username"), t("Same as the email address"), true)}
      </Row>
      {microsoft ? (
        <Row
          stacked
          label={t("Microsoft app client ID")}
          info={t("Only needed when your organization requires its own app registration.")}
        >
          {field(
            "clientId",
            t("Microsoft app client ID"),
            "00000000-0000-0000-0000-000000000000",
            true,
          )}
        </Row>
      ) : null}
    </>
  );

  return (
    <>
      <Row
        stacked
        label={account ? t("Edit email account") : t("Add email account")}
        persistence={{ mode: "explicit", state: saving ? "saving" : dirty ? "dirty" : "idle" }}
      >
        <div className="integration-fields">
          <Select
            label={t("Provider")}
            value={draft.preset}
            options={emailPresetChoices(account ? initial.preset : undefined).map((id) => ({
              value: id,
              label: emailPresetLabel(id),
            }))}
            onValueChange={(value) => {
              setDraft((current) => applyEmailPreset(current, value as EmailDraft["preset"]));
            }}
            disabled={saving}
          />
          <TextField
            label={t("Email address")}
            aria-label={t("Email address")}
            type="email"
            value={draft.address}
            onChange={(event) => set("address", event.target.value)}
            placeholder="name@example.com"
            autoComplete="email"
            spellCheck={false}
            disabled={saving}
          />
          <TextField
            label={t("Display name")}
            aria-label={t("Display name")}
            value={draft.displayName}
            onChange={(event) => set("displayName", event.target.value)}
            placeholder={t("Name shown to recipients")}
            autoComplete="name"
            disabled={saving}
          />
          {draft.auth !== "password" ? null : (
            <div className="integration-secret">
              <PasswordField
                label={t("Password or app password")}
                aria-label={t("Password or app password")}
                value={draft.password}
                onChange={(event) => set("password", event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") submit();
                }}
                placeholder={account ? t("Leave empty to keep the saved password") : undefined}
                autoComplete="off"
                spellCheck={false}
                disabled={saving}
              />
              {appPasswordPage ? (
                <InfoPopover label={t("About app passwords")} className="shrink-0">
                  <Text as="p" size="caption" tone="inherit">
                    {t(
                      "With 2-step verification on, this provider rejects your normal password. Create an app password and enter it here.",
                    )}
                  </Text>
                  <Button
                    variant="link"
                    startIcon={<ExternalLink className="icon-sm" />}
                    onClick={() => {
                      openExternal(appPasswordPage).catch(() => undefined);
                    }}
                  >
                    {t("Open app password settings")}
                  </Button>
                </InfoPopover>
              ) : null}
            </div>
          )}
        </div>
      </Row>
      {microsoft ? (
        <Row
          stacked
          label={t("Microsoft account")}
          info={t(
            "Outlook.com, Hotmail and Microsoft 365 mailboxes sign in with Microsoft instead of a password.",
          )}
        >
          <MicrosoftDeviceSignIn
            purpose="outlook"
            clientId={draft.clientId}
            signedIn={signedIn}
            disabled={saving || !draft.address.trim()}
            onSignedIn={(handle) => {
              setAuthHandle(handle);
              submit(handle);
            }}
          />
        </Row>
      ) : null}
      {google ? (
        <Row
          stacked
          label={t("Google account")}
          info={t("Gmail and Google Workspace mailboxes sign in with Google in your browser.")}
        >
          <BrowserSignIn
            purpose="google"
            clientId={draft.clientId}
            clientSecret={clientSecret}
            loginHint={draft.address}
            signedIn={signedIn}
            disabled={saving}
            fallback={
              googleChoice
                ? {
                    hint: t("Can't sign in with Google?"),
                    action: t("Use an app password instead"),
                    onSelect: () => set("auth", "password"),
                  }
                : undefined
            }
            onSignedIn={(handle, identity) => {
              setAuthHandle(handle);
              setDraft((current) =>
                identity && identity.toLowerCase() !== current.address.trim().toLowerCase()
                  ? { ...current, address: identity }
                  : current,
              );
            }}
          />
        </Row>
      ) : null}
      {draft.preset === "custom" ? (
        serverRows
      ) : (
        <AdvancedSettings
          title={googleChoice ? t("Advanced") : t("Server settings")}
          defaultOpen={false}
          keepMounted
        >
          {serverRows}
        </AdvancedSettings>
      )}
      <AccountFormActions
        saving={saving}
        error={error}
        disabled={draft.auth !== "password" && !signedIn}
        onSave={() => submit()}
        onCancel={onCancel}
      />
    </>
  );
}
