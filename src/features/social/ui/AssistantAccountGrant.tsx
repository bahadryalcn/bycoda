import { useState } from "react";
import { Button } from "../../../shared/ui/Button";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { InlineError } from "../../../shared/ui/InlineError";
import { t } from "../../../shared/i18n";
import type { SocialAccount } from "../model/social";
import type { SocialClient } from "../model/socialClient";
import { useSocialPending } from "./useSocialPending";
import "./assistant-account-grant.css";

export function AssistantAccountGrant({
  account,
  client,
  run,
  locked,
}: {
  account: SocialAccount;
  client: SocialClient;
  run: (work: () => Promise<unknown>) => Promise<boolean>;
  locked: boolean;
}) {
  const pendingUi = useSocialPending();
  const [saveError, setSaveError] = useState("");
  const [assistantPermissions, setAssistantPermissions] = useState<("read" | "draft")[]>(
    () => account.assistantGrantPending?.permissions ?? account.assistantGrant?.permissions ?? [],
  );
  const [assistantVersion, setAssistantVersion] = useState<string | null>(
    () => account.assistantGrant?.version ?? null,
  );
  return (
    <details className="social-form social-account-permissions">
      <summary>{t("Assistant account access")}</summary>
      <p className="text-ui-caption text-(--ui-text-secondary)">
        {t(
          "Access applies only to this account and can be revoked here. Sending still requires owner approval.",
        )}
      </p>
      {account.assistantGrantPending ? (
        <InlineError>
          {t(
            "Assistant access is paused while voice retirement is pending. Reconnect the original device and save again to retry.",
          )}
        </InlineError>
      ) : null}
      <form
        className="social-form"
        onSubmit={(event) => {
          event.preventDefault();
          setSaveError("");
          void pendingUi
            .run("accounts.save-assistant", async () => {
              let saved: SocialAccount | undefined;
              const success = await run(async () => {
                saved = await client.request<SocialAccount>("accounts.assistantGrant", {
                  accountId: account.id,
                  permissions: assistantPermissions,
                  expectedVersion: assistantVersion,
                });
              });
              if (success && saved?.assistantGrant)
                setAssistantVersion(saved.assistantGrant.version);
            })
            .catch(() => setSaveError(t("Assistant access could not be saved. Try again.")));
        }}
      >
        <fieldset className="social-checks social-assistant-checks">
          <legend>{t("Assistant permissions")}</legend>
          <label>
            <Checkbox
              disabled={locked}
              checked={assistantPermissions.includes("read")}
              onChange={(event) => setAssistantPermissions(event.target.checked ? ["read"] : [])}
            />
            {t("Can read")}
          </label>
          <label>
            <Checkbox
              disabled={locked || !assistantPermissions.includes("read")}
              checked={assistantPermissions.includes("draft")}
              onChange={(event) =>
                setAssistantPermissions(event.target.checked ? ["read", "draft"] : ["read"])
              }
            />
            {t("Prepare drafts")}
          </label>
        </fieldset>
        {saveError ? <InlineError>{saveError}</InlineError> : null}
        <Button
          loading={pendingUi.is("accounts.save-assistant")}
          type="submit"
          variant="secondary"
          disabled={locked}
        >
          {t("Save permissions")}
        </Button>
      </form>
    </details>
  );
}
