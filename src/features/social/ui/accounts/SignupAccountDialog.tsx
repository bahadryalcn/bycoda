import { useId, useState } from "react";
import { t } from "../../../../shared/i18n";
import { Badge } from "../../../../shared/ui/Badge";
import { Button } from "../../../../shared/ui/Button";
import { DatePicker } from "../../../../shared/ui/DatePicker";
import { toLocalDateTime } from "../../../../shared/ui/DateTimePicker";
import { InlineError, InlineMessage } from "../../../../shared/ui/InlineError";
import { Modal, ModalActions } from "../../../../shared/ui/Modal";
import { Text } from "../../../../shared/ui/Text";
import { TextField } from "../../../../shared/ui/TextField";
import { usePollingRefresh } from "../../hooks/usePollingRefresh";
import { SOCIAL_PLATFORM_NAMES, type SocialAccount, type SocialPlatform } from "../../model/social";
import type { SocialBrowserWorkflow, SocialRegistrationField } from "../../model/socialBrowser";
import type { SocialClient } from "../../model/socialClient";
import { DisabledReason, gateProps, type ActionGate } from "../common/DisabledReason";
import { hostConnection } from "./connectOptions";
import {
  blockerLabel,
  isSignupLive,
  latestSignup,
  missingFields,
  registrationFieldLabel,
  registrationFieldProblem,
  registrationProfile,
  signupProblem,
  signupStatus,
  signupStepLabel,
  SIGNUP_FIELD_ORDER,
} from "./signupModel";
import { useAccountWrite } from "./useAccountWrite";
import "./accounts.css";

const POLL_MS = 3000;

export type SignupAccountDialogProps = {
  client: SocialClient;
  platform: SocialPlatform;
  accountType: string;
  /** Local label for the account record; the owner may still edit it before the window opens. */
  initialName: string;
  projectIds: string[];
  /** An account record the Host already created (an approved account request); the dialog then creates none and hides the name. */
  existingAccountId?: string;
  /** A signup the caller already began for `existingAccountId`, so the dialog opens on its progress. */
  initialWorkflow?: SocialBrowserWorkflow;
  onClose(): void;
  /** Called with the account id once the record exists; the screen opens its detail to sign in. */
  onCreated(accountId: string): void;
};

/**
 * Creates a new platform account through the owner-assisted signup workflow. The dialog creates the
 * browser account record, opens the platform's signup window and shows which steps the owner must
 * finish there. It only collects non-secret fields; passwords, codes, terms and security checks
 * are completed in the platform window. When the window closes the owner continues to the
 * account's browser sign-in, which verifies the identity.
 */
export function SignupAccountDialog({
  client,
  platform,
  accountType,
  initialName,
  projectIds,
  existingAccountId,
  initialWorkflow,
  onClose,
  onCreated,
}: SignupAccountDialogProps) {
  const formId = useId();
  const [name, setName] = useState(initialName);
  const [accountId, setAccountId] = useState<string | undefined>(existingAccountId);
  const [workflow, setWorkflow] = useState<SocialBrowserWorkflow | undefined>(initialWorkflow);
  const [draft, setDraft] = useState<Partial<Record<SocialRegistrationField, string>>>({});
  const [pollError, setPollError] = useState("");
  const { error, is, write } = useAccountWrite(t("The signup could not be started. Try again."));
  const live = isSignupLive(workflow);

  // Keep the signup status current while the Host drives the window; the owner works there, not here.
  usePollingRefresh({
    active: Boolean(accountId && live),
    scope: accountId,
    intervalMs: POLL_MS,
    load: async (isCurrent) => {
      if (!accountId) return;
      try {
        const state = await client.browserWorkflowStatus(accountId);
        if (!isCurrent()) return;
        setPollError("");
        const next = latestSignup(state, accountId);
        if (next) setWorkflow(next);
      } catch (error) {
        if (isCurrent()) setPollError(t("The signup status could not be read. Retrying."));
        throw error;
      }
    },
  });

  const registration = workflow?.registration;
  const required = SIGNUP_FIELD_ORDER.filter((field) =>
    registration?.requiredFields.includes(field),
  );
  const missing = missingFields(required, draft);
  // Snapchat web signup creates a member account. A Public Profile is a separate step.
  const signupAccountType = platform === "snapchat" && !existingAccountId ? "member" : accountType;
  const update = (field: SocialRegistrationField, value: string) =>
    setDraft((current) => ({ ...current, [field]: value }));

  const start = () =>
    void write("start", async () => {
      // Reuse the record when an earlier attempt created it but the window did not open.
      let id = accountId;
      if (!id) {
        const created = await client.request<SocialAccount>("accounts.create", {
          platform,
          name: name.trim(),
          accountType: signupAccountType,
          connection: hostConnection(platform, "browser"),
          projectIds,
        });
        id = created.id;
        setAccountId(id);
      }
      setWorkflow(
        await client.browserWorkflowBegin(
          id,
          "signup",
          undefined,
          registrationProfile(signupAccountType, draft),
        ),
      );
    }).catch(() => undefined);

  const advance = () => {
    if (!workflow || !accountId) return;
    void write("advance", async () =>
      setWorkflow(
        await client.browserRegistrationAdvance(
          accountId,
          workflow.id,
          workflow.updatedAt,
          registrationProfile(accountType, draft),
        ),
      ),
    ).catch(() => undefined);
  };

  /** Stops a live window, then leaves for the account's detail where it can be signed in or removed. */
  const leave = () =>
    void write("leave", async () => {
      if (accountId && live) await client.browserWorkflowCancel(accountId);
      if (accountId) onCreated(accountId);
      else onClose();
    }).catch(() => undefined);

  const busy = is("start") || is("advance") || is("leave");
  const canStart = !workflow || (!live && workflow.status !== "window_closed");
  const startGate: ActionGate =
    !existingAccountId && !name.trim()
      ? { disabled: true, disabledReason: t("Enter a name for this account.") }
      : { disabled: false };
  const advanceGate: ActionGate =
    workflow?.status !== "awaiting_owner"
      ? { disabled: true, disabledReason: t("Waiting for the window to open.") }
      : missing.length
        ? { disabled: true, disabledReason: t("Fill in the fields above.") }
        : { disabled: false };
  const problem = workflow ? signupProblem(workflow) : undefined;
  const blocked =
    live && (registration?.step === "rate_limit" || registration?.step === "network_blocked");
  const status = workflow && !blocked ? signupStatus(workflow) : undefined;
  const ownerInstruction =
    live &&
    !blocked &&
    registration?.status === "awaiting_owner" &&
    !registration.canAdvance &&
    registration.message;

  return (
    <Modal
      title={t("Create a {p0} account", { p0: SOCIAL_PLATFORM_NAMES[platform] })}
      onClose={() => {
        if (!busy && !live) leave();
      }}
      closeDisabled={busy || live}
      size="md"
      footer={
        <ModalActions className="social-dialog-actions">
          <Button variant="ghost" disabled={busy} onClick={leave}>
            {live ? t("Stop signup") : t("Close")}
          </Button>
          {canStart ? (
            <DisabledReason
              type="submit"
              form={formId}
              variant="primary"
              loading={is("start")}
              {...gateProps(startGate)}
            >
              {workflow ? t("Start again") : t("Open sign-up window")}
            </DisabledReason>
          ) : null}
          {live && !blocked ? (
            <DisabledReason
              variant="primary"
              loading={is("advance")}
              onClick={advance}
              {...gateProps(advanceGate)}
            >
              {t("Continue")}
            </DisabledReason>
          ) : null}
          {workflow?.status === "window_closed" && accountId ? (
            <Button variant="primary" onClick={() => onCreated(accountId)}>
              {t("Continue to sign-in")}
            </Button>
          ) : null}
        </ModalActions>
      }
    >
      <form
        id={formId}
        className="social-field-row"
        onSubmit={(event) => {
          event.preventDefault();
          if (canStart && !startGate.disabled) start();
        }}
      >
        {!workflow && !existingAccountId ? (
          <TextField
            label={t("Name")}
            value={name}
            maxLength={200}
            required
            disabled={busy}
            onChange={(event) => setName(event.currentTarget.value)}
          />
        ) : null}
        {status ? (
          <div className="social-tag-line">
            <Badge tone={status.tone}>{status.label}</Badge>
            {registration &&
            !ownerInstruction &&
            !registration.blockers.some((item) => item === registration.step) ? (
              <Text as="span" tone="muted">
                {signupStepLabel(registration.step)}
              </Text>
            ) : null}
          </div>
        ) : null}
        {ownerInstruction ? (
          <Text as="p">{t(ownerInstruction)}</Text>
        ) : status && registration?.message ? (
          <Text as="p" tone="muted" size="caption" wrap="anywhere">
            {t(registration.message)}
          </Text>
        ) : null}
        {live && registration?.blockers.length ? (
          <div className="social-tag-line">
            {registration.blockers.map((blocker) => (
              <Badge key={blocker} tone="warning">
                {blockerLabel(blocker)}
              </Badge>
            ))}
          </div>
        ) : null}
        {live
          ? required.map((field) =>
              field === "birthdate" ? (
                <DatePicker
                  key={field}
                  label={registrationFieldLabel(field)}
                  value={draft[field] ?? ""}
                  max={toLocalDateTime(new Date()).slice(0, 10)}
                  disabled={busy}
                  onChange={(value) => update(field, value)}
                />
              ) : (
                <TextField
                  key={field}
                  label={registrationFieldLabel(field)}
                  value={draft[field] ?? ""}
                  type={field === "phone" ? "tel" : "text"}
                  maxLength={field === "email" ? 254 : 100}
                  error={registrationFieldProblem(field, draft[field] ?? "")}
                  disabled={busy}
                  onChange={(event) => update(field, event.currentTarget.value)}
                />
              ),
            )
          : null}
        {platform === "facebook" &&
        accountType === "page" &&
        (!live || (registration?.step === "profile" && required.length > 0)) ? (
          <TextField
            label={registrationFieldLabel("bio")}
            value={draft.bio ?? ""}
            maxLength={100}
            disabled={busy}
            onChange={(event) => update("bio", event.currentTarget.value)}
          />
        ) : null}
        {problem ? <InlineMessage tone="warning">{problem}</InlineMessage> : null}
        {pollError ? <InlineMessage tone="info">{pollError}</InlineMessage> : null}
        {error ? <InlineError>{error}</InlineError> : null}
      </form>
    </Modal>
  );
}
