import { useState } from "react";
import { t } from "../../../../../shared/i18n";
import { Button } from "../../../../../shared/ui/Button";
import { InlineError, InlineMessage } from "../../../../../shared/ui/InlineError";
import { usePollingRefresh } from "../../../hooks/usePollingRefresh";
import type { SocialBrowserWorkflow } from "../../../model/socialBrowser";
import type { SocialClient } from "../../../model/socialClient";
import { useAccountWrite } from "../useAccountWrite";

function isRunning(workflow?: SocialBrowserWorkflow | null) {
  return workflow?.status === "queued" || workflow?.status === "awaiting_owner";
}

/** Opens the provider's native inbox in the selected account's browser profile. */
export function BrowserInboxHandoff({
  accountId,
  client,
  disabled,
  instruction,
  visible = true,
}: {
  accountId: string;
  client: SocialClient;
  disabled: boolean;
  instruction: string;
  visible?: boolean;
}) {
  const [workflow, setWorkflow] = useState<SocialBrowserWorkflow | null>();
  const [statusError, setStatusError] = useState(false);
  const { error, is, write } = useAccountWrite(t("Could not open the link."));
  const active = isRunning(workflow);
  const checking = workflow === undefined && !statusError;
  const loadWorkflow = async (id?: string) => {
    const state = await client.browserWorkflowStatus(accountId);
    const inbox = state.workflows.filter((item) => item.intent === "inbox");
    if (id === undefined) return inbox.find(isRunning) ?? null;
    const entry = inbox.find((item) => item.id === id);
    if (!entry) throw new Error(t("Could not load this view."));
    return entry;
  };
  usePollingRefresh({
    active:
      visible && (workflow === undefined || active) && !disabled && !is("open") && !is("cancel"),
    scope: workflow?.id,
    intervalMs: 1_000,
    load: async (isCurrent) => {
      try {
        const next = await loadWorkflow(workflow?.id);
        if (isCurrent()) {
          setWorkflow((current) => (current === workflow ? next : current));
          setStatusError(false);
        }
      } catch (cause) {
        if (isCurrent()) setStatusError(true);
        throw cause;
      }
    },
  });
  if (!visible) return null;
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Button
        variant="primary"
        size="sm"
        className="self-start"
        disabled={disabled || active || is("cancel")}
        loading={(checking && !disabled) || is("open")}
        onClick={() =>
          void write("open", async () => {
            setStatusError(false);
            setWorkflow(await client.browserWorkflowBegin(accountId, "inbox"));
          }).catch(() => undefined)
        }
      >
        {t("Open in browser")}
      </Button>
      {active && workflow ? (
        <Button
          size="sm"
          className="self-start"
          disabled={disabled}
          loading={is("cancel")}
          onClick={() =>
            void write("cancel", async () => {
              await client.browserWorkflowCancel(accountId, workflow.id);
              setWorkflow(await loadWorkflow(workflow.id));
              setStatusError(false);
            }).catch(() => undefined)
          }
        >
          {t("Cancel")}
        </Button>
      ) : null}
      {workflow?.status === "queued" ? (
        <InlineMessage tone="info">{t("Waiting for browser…")}</InlineMessage>
      ) : null}
      {workflow?.status === "awaiting_owner" ? (
        <InlineMessage tone="info">{instruction}</InlineMessage>
      ) : null}
      {workflow?.status === "window_closed" ? (
        <InlineMessage tone="info">{t("Window closed")}</InlineMessage>
      ) : null}
      {workflow?.status === "cancelled" ? (
        <InlineMessage tone="info">{t("Cancelled")}</InlineMessage>
      ) : null}
      {statusError ? <InlineError>{t("Could not load this view.")}</InlineError> : null}
      {["failed", "expired", "interrupted"].includes(workflow?.status ?? "") ? (
        <InlineError>{t("Could not open the link. Try again.")}</InlineError>
      ) : null}
      {error ? <InlineError>{error}</InlineError> : null}
    </div>
  );
}
