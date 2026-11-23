import { InlineError } from "../../../../shared/ui/InlineError";
import { useId, useState } from "react";
import { t } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";
import { Checkbox } from "../../../../shared/ui/Checkbox";
import { FieldGroup } from "../../../../shared/ui/FieldGroup";

import { Modal, ModalActions } from "../../../../shared/ui/Modal";
import { Select } from "../../../../shared/ui/Select";
import { TextField } from "../../../../shared/ui/TextField";
import type { HostProject } from "../../../connections/public/protocol";
import { SOCIAL_PLATFORM_NAMES, type SocialAccount, type SocialPlatform } from "../../model/social";
import type { SocialClient } from "../../model/socialClient";
import {
  accountTypesFor,
  connectionMethods,
  defaultConnectionMethod,
  hostConnection,
  type ConnectionMethod,
} from "./connectOptions";
import { EmailAccountDialog } from "./EmailAccountDialog";
import { ProviderSelect } from "./ProviderSelect";
import { SignupAccountDialog } from "./SignupAccountDialog";
import { canCreateAccount } from "./signupModel";
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
  const [kind, setKind] = useState<"account" | "email" | "signup">("account");
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

  const choosePlatform = (next: SocialPlatform) => {
    const nextMethod = defaultConnectionMethod(next);
    setPlatform(next);
    setMethod(nextMethod);
    setAccountType(accountTypesFor(next, nextMethod)[0] ?? "");
  };

  if (kind === "email")
    return (
      <EmailAccountDialog
        client={client}
        onClose={onClose}
        onCreated={onCreated}
        onSwitchToAccount={(next) => {
          choosePlatform(next);
          setKind("account");
        }}
      />
    );

  if (kind === "signup")
    return (
      <SignupAccountDialog
        client={client}
        platform={platform}
        accountType={accountType}
        initialName={name}
        projectIds={picked}
        onClose={onClose}
        onCreated={onCreated}
      />
    );

  const types = accountTypesFor(platform, method);
  const methods = connectionMethods(platform);
  const chooseMethod = (next: ConnectionMethod) => {
    setMethod(next);
    if (!accountTypesFor(platform, next).includes(accountType))
      setAccountType(accountTypesFor(platform, next)[0] ?? "");
  };
  // An empty name is obvious from the required field, so the button is off without a sentence.
  const blocked = !name.trim() || !accountType;

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
          <Button
            type="submit"
            form={formId}
            variant="primary"
            loading={is("create")}
            disabled={blocked}
          >
            {t("Connect")}
          </Button>
        </ModalActions>
      }
    >
      <form
        id={formId}
        className="social-field-row"
        onSubmit={(event) => {
          event.preventDefault();
          if (!blocked) submit();
        }}
      >
        <ProviderSelect
          value={platform}
          onChange={(value) => (value === "email" ? setKind("email") : choosePlatform(value))}
        />
        {/* A single valid choice is not a question: the select appears only when there is a pick. */}
        {methods.length > 1 ? (
          <Select
            label={t("How to connect")}
            value={method}
            options={methods.map((item) => ({
              value: item,
              label: methodText(item),
            }))}
            onValueChange={(value) => chooseMethod(value as ConnectionMethod)}
          />
        ) : null}
        {types.length > 1 ? (
          <Select
            label={t("Account type")}
            value={accountType}
            options={types.map((item) => ({ value: item, label: accountTypeText(item) }))}
            onValueChange={setAccountType}
          />
        ) : null}
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
              size="secondary"
              className="social-check"
            />
          ))}
        </FieldGroup>
        {canCreateAccount(platform, method) ? (
          <Button variant="link" size="sm" onClick={() => setKind("signup")}>
            {t("Create a new {p0} account instead", { p0: SOCIAL_PLATFORM_NAMES[platform] })}
          </Button>
        ) : null}
        {error ? <InlineError>{error}</InlineError> : null}
      </form>
    </Modal>
  );
}
