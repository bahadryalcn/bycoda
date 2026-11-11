import { useId, useState } from "react";
import { t } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";
import { Checkbox } from "../../../../shared/ui/Checkbox";
import { FieldGroup } from "../../../../shared/ui/FieldGroup";
import { InlineMessage } from "../../../../shared/ui/InlineError";
import { Modal, ModalActions } from "../../../../shared/ui/Modal";
import { Select } from "../../../../shared/ui/Select";
import { TextField } from "../../../../shared/ui/TextField";
import type { HostProject } from "../../../connections/public/protocol";
import {
  SOCIAL_PLATFORMS,
  SOCIAL_PLATFORM_NAMES,
  type SocialAccount,
  type SocialPlatform,
} from "../../model/social";
import type { SocialClient } from "../../model/socialClient";
import { DisabledReason, gateProps, type ActionGate } from "../common/DisabledReason";
import {
  accountTypesFor,
  connectionMethods,
  defaultConnectionMethod,
  hostConnection,
  type ConnectionMethod,
} from "./connectOptions";
import { EmailAccountDialog } from "./EmailAccountDialog";
import { useAccountWrite } from "./useAccountWrite";
import "./accounts.css";

export type ConnectAccountDialogProps = {
  client: SocialClient;
  projects: HostProject[];
  initialProjectId?: string;
  onClose(): void;
  /** Called with the new account id; the screen opens its detail to finish the connection. */
  onCreated(accountId: string): void;
};

export function accountTypeText(id: string): string {
  const labels: Record<string, string> = {
    member: t("Member"),
    professional: t("Professional"),
    page: t("Page"),
    channel: t("Channel"),
    organization: t("Organization account"),
    public_profile: t("Public profile"),
    business: t("Business"),
    bot: t("Bot"),
  };
  return labels[id] ?? id;
}

function methodText(method: ConnectionMethod): string {
  switch (method) {
    case "api":
      return t("Official API");
    case "browser":
      return t("Browser sign-in");
    case "token":
      return t("Token from this computer");
  }
}

/**
 * Adds an account. The official API is chosen by default where the platform has one; otherwise the
 * browser. The connection itself (sign-in, OAuth, token, channel review) happens in the account's
 * detail after it is created. Email accounts are added from the same dialog.
 */
export function ConnectAccountDialog({
  client,
  projects,
  initialProjectId,
  onClose,
  onCreated,
}: ConnectAccountDialogProps) {
  const formId = useId();
  const [kind, setKind] = useState<"account" | "email">("account");
  const [platform, setPlatform] = useState<SocialPlatform>("x");
  const [method, setMethod] = useState<ConnectionMethod>(() => defaultConnectionMethod("x"));
  const [accountType, setAccountType] = useState(
    () => accountTypesFor("x", defaultConnectionMethod("x"))[0] ?? "",
  );
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<string[]>(() =>
    initialProjectId ? [initialProjectId] : [],
  );
  const { error, is, write } = useAccountWrite(t("The account could not be added. Try again."));

  if (kind === "email")
    return <EmailAccountDialog client={client} onClose={onClose} onCreated={onCreated} />;

  const types = accountTypesFor(platform, method);
  const choosePlatform = (next: SocialPlatform) => {
    const nextMethod = defaultConnectionMethod(next);
    setPlatform(next);
    setMethod(nextMethod);
    setAccountType(accountTypesFor(next, nextMethod)[0] ?? "");
  };
  const chooseMethod = (next: ConnectionMethod) => {
    setMethod(next);
    if (!accountTypesFor(platform, next).includes(accountType))
      setAccountType(accountTypesFor(platform, next)[0] ?? "");
  };
  const gate: ActionGate = !name.trim()
    ? { disabled: true, disabledReason: t("Enter a name for this account.") }
    : !accountType
      ? { disabled: true, disabledReason: t("Choose an account type.") }
      : { disabled: false };

  const submit = () =>
    void write("create", () =>
      client.request<SocialAccount>("accounts.create", {
        platform,
        name: name.trim(),
        accountType,
        connection: hostConnection(platform, method),
        projectIds: picked,
      }),
    )
      .then((created) => created && onCreated(created.id))
      .catch(() => undefined);

  return (
    <Modal
      title={t("Connect account")}
      onClose={() => {
        if (!is("create")) onClose();
      }}
      size="md"
      footer={
        <ModalActions>
          <Button variant="ghost" disabled={is("create")} onClick={onClose}>
            {t("Cancel")}
          </Button>
          <DisabledReason
            type="submit"
            form={formId}
            variant="primary"
            loading={is("create")}
            {...gateProps(gate)}
          >
            {t("Connect")}
          </DisabledReason>
        </ModalActions>
      }
    >
      <form
        id={formId}
        className="social-field-row"
        onSubmit={(event) => {
          event.preventDefault();
          if (!gate.disabled) submit();
        }}
      >
        <Select
          label={t("Platform")}
          value={platform}
          options={SOCIAL_PLATFORMS.map((item) => ({
            value: item,
            label: SOCIAL_PLATFORM_NAMES[item],
          }))}
          onValueChange={(value) => choosePlatform(value as SocialPlatform)}
        />
        <Select
          label={t("How to connect")}
          value={method}
          options={connectionMethods(platform).map((item) => ({
            value: item,
            label: methodText(item),
          }))}
          onValueChange={(value) => chooseMethod(value as ConnectionMethod)}
        />
        <Select
          label={t("Account type")}
          value={accountType}
          options={types.map((item) => ({ value: item, label: accountTypeText(item) }))}
          onValueChange={setAccountType}
        />
        <TextField
          label={t("Name")}
          value={name}
          maxLength={200}
          required
          onChange={(event) => setName(event.currentTarget.value)}
        />
        <FieldGroup legend={t("Projects that may use it")} layout="row">
          {projects.map((project) => (
            <Checkbox
              checked={picked.includes(project.id)}
              onChange={(event) =>
                setPicked(
                  event.target.checked
                    ? [...picked, project.id]
                    : picked.filter((id) => id !== project.id),
                )
              }
              label={project.name}
              key={project.id}
              className="social-check"
            />
          ))}
        </FieldGroup>
        <Button variant="link" size="sm" onClick={() => setKind("email")}>
          {t("Add an email account instead")}
        </Button>
        {error ? <InlineMessage tone="danger">{error}</InlineMessage> : null}
      </form>
    </Modal>
  );
}
