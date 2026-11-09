import { describe, expect, it } from "vitest";
import { emailFormError, emailSaveInput, type EmailDraft } from "./emailAccountForm";

const draft: EmailDraft = {
  kind: "resend",
  from: "hello@example.com",
  name: "Newsletter",
  host: "",
  port: "587",
  secure: false,
  unsubscribeUrl: "https://example.com/unsubscribe",
  secret: "key",
};

describe("email account form", () => {
  it("refuses an account without an https unsubscribe link", () => {
    expect(emailFormError({ ...draft, unsubscribeUrl: "" }, "create")).toBe(
      "Add an unsubscribe link before sending email.",
    );
    expect(emailFormError({ ...draft, unsubscribeUrl: "http://example.com/u" }, "create")).toBe(
      "The unsubscribe link must start with https://.",
    );
  });

  it("requires the secret when the account is created, but not when it is edited", () => {
    expect(emailFormError({ ...draft, secret: "" }, "create")).toBe("Enter the provider API key.");
    expect(emailFormError({ ...draft, secret: "" }, "edit")).toBeUndefined();
  });

  it("checks SMTP server and port", () => {
    const smtp: EmailDraft = { ...draft, kind: "smtp", host: "", port: "70000" };
    expect(emailFormError(smtp, "create")).toBe("Enter the SMTP server.");
    expect(emailFormError({ ...smtp, host: "smtp.example.com" }, "create")).toBe(
      "Enter a port between 1 and 65535.",
    );
  });

  it("sends the secret only when one was entered and adds SMTP fields only for SMTP", () => {
    expect(emailSaveInput({ ...draft, secret: "" })).not.toHaveProperty("secret");
    expect(emailSaveInput(draft)).not.toHaveProperty("host");
    const input = emailSaveInput({
      ...draft,
      kind: "smtp",
      host: "smtp.example.com",
      port: "465",
      secure: true,
    });
    expect(input).toMatchObject({
      kind: "smtp",
      host: "smtp.example.com",
      port: 465,
      secure: true,
    });
  });
});
