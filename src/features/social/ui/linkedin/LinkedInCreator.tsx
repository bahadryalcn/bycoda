import { useState } from "react";
import { openExternal } from "../../../../platform/tauri/openExternal";
import { t } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";
import { useConfirm } from "../../../../shared/ui/ConfirmDialog";
import { Disclosure } from "../../../../shared/ui/Disclosure";
import { FieldGroup } from "../../../../shared/ui/FieldGroup";
import { InlineError } from "../../../../shared/ui/InlineError";
import { Text } from "../../../../shared/ui/Text";
import { TextareaField } from "../../../../shared/ui/TextareaField";
import { TextField } from "../../../../shared/ui/TextField";
import type { SocialAccount } from "../../model/social";
import type { SocialClient } from "../../model/socialClient";
import { useAccountWrite } from "../accounts/useAccountWrite";

type Props = {
  account: SocialAccount;
  client: SocialClient;
  disabled: boolean;
};

export function LinkedInCreator({ account, client, disabled }: Props) {
  return (
    <LinkedInCreatorAccount
      key={JSON.stringify([account.id, account.platformId, account.connected, account.connection])}
      account={account}
      client={client}
      disabled={disabled}
    />
  );
}

function LinkedInCreatorAccount({ account, client, disabled }: Props) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [result, setResult] = useState<{ state: "draft"; url: string }>();
  const [inspect, setInspect] = useState(false);
  const { confirm, dialog } = useConfirm();
  const { error, is, write } = useAccountWrite(t("Could not open LinkedIn publishing."));
  const canPrepare = account.accountType === "member" && account.connection === "browser";
  const disabledWrite = disabled || is("handoff") || is("prepare") || inspect || !!result;

  const open = (format: "article" | "newsletter") =>
    write("handoff", async () => {
      const { url } = await client.request<{ url: string }>("linkedin.creator.handoff", {
        accountId: account.id,
        format,
      });
      await openExternal(url);
    });
  const prepare = async () => {
    const draft = { title: title.trim(), body: body.trim() };
    if (disabledWrite || !draft.title || !draft.body) return;
    if (
      !(await confirm({
        title: t("Prepare LinkedIn article draft?"),
        context: account.name,
        message: t("LinkedIn may save this draft automatically. Review and publish it there."),
        details: draft.title,
        confirmLabel: t("Prepare draft"),
        danger: false,
      }))
    )
      return;
    await write("prepare", async () => {
      try {
        setResult(await client.linkedInArticlePrepare(account.id, draft, crypto.randomUUID()));
      } catch {
        setInspect(true);
      }
    });
  };

  return (
    <Disclosure summary={t("Articles and newsletters")} variant="row">
      <FieldGroup variant="bare" disabled={disabled || is("handoff")} layout="row">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void open("article").catch(() => undefined)}
        >
          {t("Open article publishing")}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void open("newsletter").catch(() => undefined)}
        >
          {t("Open newsletter publishing")}
        </Button>
      </FieldGroup>
      {canPrepare ? (
        <FieldGroup legend={t("Article draft")} disabled={disabledWrite}>
          <TextField
            label={t("Title")}
            value={title}
            maxLength={100}
            onChange={(event) => setTitle(event.currentTarget.value)}
          />
          <TextareaField
            label={t("Text")}
            value={body}
            maxLength={50_000}
            onChange={(event) => setBody(event.currentTarget.value)}
          />
          <Button
            variant="primary"
            size="sm"
            loading={is("prepare")}
            disabled={!title.trim() || !body.trim()}
            onClick={() => void prepare().catch(() => undefined)}
          >
            {t("Prepare draft")}
          </Button>
        </FieldGroup>
      ) : null}
      {result ? (
        <Button
          variant="secondary"
          size="sm"
          onClick={() =>
            void write("handoff", () => openExternal(result.url)).catch(() => undefined)
          }
        >
          {t("Open LinkedIn draft")}
        </Button>
      ) : null}
      {inspect ? <Text as="p">{t("Check the draft on LinkedIn before trying again.")}</Text> : null}
      {error ? <InlineError>{error}</InlineError> : null}
      {dialog}
    </Disclosure>
  );
}
