import { useState } from "react";
import { openExternal } from "../../../../platform/tauri/openExternal";
import { t } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";
import { useConfirm } from "../../../../shared/ui/ConfirmDialog";
import { Disclosure } from "../../../../shared/ui/Disclosure";
import { FieldGroup } from "../../../../shared/ui/FieldGroup";
import { InlineError, InlineMessage } from "../../../../shared/ui/InlineError";
import { SectionLabel } from "../../../../shared/ui/SectionLabel";
import { Text } from "../../../../shared/ui/Text";
import { TextareaField } from "../../../../shared/ui/TextareaField";
import { TextField } from "../../../../shared/ui/TextField";
import type { SocialAccount } from "../../model/social";
import type { SocialClient } from "../../model/socialClient";
import { useAccountWrite } from "../accounts/useAccountWrite";
import { LinkedInHandoff } from "./LinkedInHandoff";
import "./linkedin.css";
import { linkedInBusyReason } from "./linkedinReasons";

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
  const { failureTitle, details, is, write } = useAccountWrite(
    t("Could not open LinkedIn publishing."),
  );
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
      <div className="social-li-stack">
        <div className="social-li-group">
          <SectionLabel variant="inline" size="secondary" as="h4">
            {t("Publish on LinkedIn")}
          </SectionLabel>
          <Text as="p" size="secondary" tone="muted">
            {t("LinkedIn only lets you publish articles and newsletters in its own editor.")}
          </Text>
          <ul className="social-li-list">
            <LinkedInHandoff
              description={t("Write and publish an article.")}
              action={t("Open article publishing")}
              disabled={disabled || is("handoff")}
              disabledReason={linkedInBusyReason(disabled)}
              onOpen={() => void open("article").catch(() => undefined)}
            />
            <LinkedInHandoff
              description={t("Create a newsletter or publish an issue.")}
              action={t("Open newsletter publishing")}
              disabled={disabled || is("handoff")}
              disabledReason={linkedInBusyReason(disabled)}
              onOpen={() => void open("newsletter").catch(() => undefined)}
            />
          </ul>
        </div>
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
              className="self-start"
              loading={is("prepare")}
              disabled={!title.trim() || !body.trim()}
              onClick={() => void prepare().catch(() => undefined)}
            >
              {t("Prepare draft")}
            </Button>
          </FieldGroup>
        ) : null}
        {result ? (
          <ul className="social-li-list">
            <LinkedInHandoff
              description={t("Your draft is ready. Review and publish it on LinkedIn.")}
              action={t("Open LinkedIn draft")}
              onOpen={() =>
                void write("handoff", () => openExternal(result.url)).catch(() => undefined)
              }
            />
          </ul>
        ) : null}
        {inspect ? (
          <InlineMessage tone="warning">
            {t("Check the draft on LinkedIn before trying again.")}
          </InlineMessage>
        ) : null}
        {failureTitle ? <InlineError details={details}>{failureTitle}</InlineError> : null}
      </div>
      {dialog}
    </Disclosure>
  );
}
