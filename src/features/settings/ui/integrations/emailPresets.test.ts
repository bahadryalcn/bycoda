import { describe, expect, it } from "vitest";
import {
  applyEmailPreset,
  emailDraftFromAccount,
  emailPresetChoices,
  emailSaveInput,
  type EmailDraft,
} from "./emailPresets";
import type { MessagingAccount } from "../../../messaging";

const blank = () => emailDraftFromAccount(null);
const filled = (overrides: Partial<EmailDraft> = {}): EmailDraft => ({
  ...applyEmailPreset(blank(), "gmail"),
  auth: "password",
  address: "owner@example.com",
  password: "app-password-fixture",
  ...overrides,
});

const savedAccount = (config: Record<string, unknown>): MessagingAccount => ({
  id: "acct-1",
  provider: "email",
  label: "owner@example.com",
  identity: "owner@example.com",
  config,
  connected: true,
  createdAt: 1,
  updatedAt: 1,
});

describe("email presets", () => {
  it("prefills each preset's servers", () => {
    expect(applyEmailPreset(blank(), "outlook")).toMatchObject({
      imapHost: "outlook.office365.com",
      imapPort: "993",
      imapSecurity: "tls",
      smtpHost: "smtp.office365.com",
      smtpPort: "587",
      smtpSecurity: "starttls",
    });
    expect(applyEmailPreset(blank(), "yahoo")).toMatchObject({
      imapHost: "imap.mail.yahoo.com",
      smtpHost: "smtp.mail.yahoo.com",
      smtpPort: "465",
    });
    expect(applyEmailPreset(blank(), "icloud")).toMatchObject({
      imapHost: "imap.mail.me.com",
      smtpHost: "smtp.mail.me.com",
      smtpSecurity: "starttls",
    });
  });

  it("defaults Gmail to Google sign-in, Outlook to Microsoft and the rest to a password", () => {
    expect(blank()).toMatchObject({ preset: "gmail", auth: "google" });
    expect(applyEmailPreset(blank(), "outlook").auth).toBe("microsoft");
    expect(applyEmailPreset(blank(), "yahoo").auth).toBe("password");
    expect(applyEmailPreset(blank(), "icloud").auth).toBe("password");
    expect(applyEmailPreset(blank(), "custom").auth).toBe("password");
  });

  it("drops a client ID when the sign-in provider changes", () => {
    const outlook = { ...applyEmailPreset(blank(), "outlook"), clientId: "ms-app" };
    expect(applyEmailPreset(outlook, "gmail").clientId).toBe("");
    const gmail = { ...blank(), clientId: "google-app" };
    expect(applyEmailPreset(gmail, "gmail").clientId).toBe("google-app");
  });

  it("keeps a saved account's sign-in and falls back to the preset default", () => {
    const saved = (auth: string) => emailDraftFromAccount(savedAccount({ preset: "gmail", auth }));
    expect(saved("password").auth).toBe("password");
    expect(saved("other").auth).toBe("google");
  });

  it("offers Outlook only to an account that already uses it", () => {
    expect(emailPresetChoices()).toEqual(["gmail", "yahoo", "icloud", "custom"]);
    expect(emailPresetChoices("gmail")).not.toContain("outlook");
    expect(emailPresetChoices("outlook")).toContain("outlook");
  });

  it("keeps typed servers when switching to Other", () => {
    const custom = applyEmailPreset({ ...filled(), imapHost: "mail.example.org" }, "custom");
    expect(custom.preset).toBe("custom");
    expect(custom.imapHost).toBe("mail.example.org");
  });
});

describe("email save input", () => {
  it("maps a new password account with numeric ports and the address as username", () => {
    const result = emailSaveInput(filled({ displayName: " Owner " }));
    expect(result).toEqual({
      ok: true,
      input: {
        provider: "email",
        label: "owner@example.com",
        config: {
          preset: "gmail",
          address: "owner@example.com",
          displayName: "Owner",
          username: "owner@example.com",
          imapHost: "imap.gmail.com",
          imapPort: 993,
          imapSecurity: "tls",
          smtpHost: "smtp.gmail.com",
          smtpPort: 465,
          smtpSecurity: "tls",
          auth: "password",
        },
        secret: { password: "app-password-fixture" },
      },
    });
  });

  it("keeps the stored password when an edit leaves it empty", () => {
    const draft = emailDraftFromAccount(
      savedAccount({
        ...applyEmailPreset(blank(), "gmail"),
        auth: "password",
        address: "owner@example.com",
      }),
    );
    expect(draft.auth).toBe("password");
    expect(draft.password).toBe("");
    const result = emailSaveInput(draft, { id: "acct-1" });
    expect(result.ok && result.input.id).toBe("acct-1");
    expect(result.ok && "secret" in result.input).toBe(false);
  });

  it("requires a password for a new password account", () => {
    expect(emailSaveInput(filled({ password: "" })).ok).toBe(false);
  });

  it("rejects an unusable address or port before calling native", () => {
    expect(emailSaveInput(filled({ address: "owner" })).ok).toBe(false);
    expect(emailSaveInput(filled({ imapPort: "99999" })).ok).toBe(false);
    expect(emailSaveInput(filled({ smtpHost: " " })).ok).toBe(false);
  });

  it("sends Microsoft accounts with the sign-in handle and never a password", () => {
    const draft = { ...applyEmailPreset(filled(), "outlook"), clientId: " client-fixture " };
    expect(emailSaveInput(draft).ok).toBe(false);
    const result = emailSaveInput(draft, { authHandle: "handle-1" });
    expect(result.ok && result.input.authHandle).toBe("handle-1");
    expect(result.ok && result.input.secret).toBeUndefined();
    expect(result.ok && result.input.config).toMatchObject({
      auth: "microsoft",
      clientId: "client-fixture",
    });
  });

  it("sends Google accounts with the sign-in handle and no password", () => {
    const clientId = " app.apps.googleusercontent.com ";
    const draft = filled({ auth: "google", password: "", clientId });
    expect(emailSaveInput(draft).ok).toBe(false);
    const result = emailSaveInput(draft, { authHandle: "browser-1" });
    expect(result.ok && result.input.authHandle).toBe("browser-1");
    expect(result.ok && result.input.secret).toBeUndefined();
    expect(result.ok && result.input.config).toMatchObject({
      preset: "gmail",
      auth: "google",
      clientId: "app.apps.googleusercontent.com",
    });
  });

  it("lets a Google edit keep its stored tokens without signing in again", () => {
    const result = emailSaveInput(filled({ auth: "google", password: "" }), { id: "acct-1" });
    expect(result.ok && result.input.authHandle).toBeUndefined();
    expect(result.ok && result.input.secret).toBeUndefined();
  });

  it("never sends a client ID or sign-in handle for an app password", () => {
    const result = emailSaveInput(filled({ clientId: "google-app" }), { authHandle: "browser-1" });
    expect(result.ok && result.input.config.clientId).toBeUndefined();
    expect(result.ok && result.input.authHandle).toBeUndefined();
    expect(result.ok && result.input.secret).toEqual({ password: "app-password-fixture" });
  });

  it("lets a Microsoft edit keep its stored tokens without signing in again", () => {
    const draft = applyEmailPreset(filled(), "outlook");
    const result = emailSaveInput(draft, { id: "acct-1" });
    expect(result.ok && result.input.authHandle).toBeUndefined();
  });

  it("restores a saved account's servers and ignores malformed config", () => {
    const draft = emailDraftFromAccount(
      savedAccount({
        preset: "custom",
        imapHost: "mail.example.org",
        imapPort: "x",
        smtpSecurity: 3,
      }),
    );
    expect(draft).toMatchObject({
      preset: "custom",
      address: "owner@example.com",
      imapHost: "mail.example.org",
      imapPort: "993",
      smtpSecurity: "starttls",
    });
  });
});
