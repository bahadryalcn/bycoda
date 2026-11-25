import { useRef, useState } from "react";
import { useT } from "../../../shared/i18n";
import { errorText } from "../../../shared/lib/errors";
import { openUrlSafely } from "../../../shared/lib/openUrlSafely";
import { Button } from "../../../shared/ui/Button";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { ExternalLink } from "../../../shared/ui/icons";
import { InlineError } from "../../../shared/ui/InlineError";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { Popover } from "../../../shared/ui/Popover";
import { Text } from "../../../shared/ui/Text";
import { jiraIssueDetails, type JiraIssueStatus } from "../model/jira";
import { jiraIssueTransitions, jiraTransitionIssue, type JiraTransition } from "../model/jiraBoard";
import type { InboxStatusMark } from "./InboxPresentation";

type PickerState =
  | { phase: "loading" | "saving" }
  | { phase: "choices"; transitions: JiraTransition[] }
  | { phase: "error"; message: string; saved: boolean };

export function JiraStatusPicker({
  issueKey,
  url,
  mark,
  status,
  onChange,
}: {
  issueKey: string;
  url: string;
  mark: InboxStatusMark;
  status: string;
  onChange: (status: JiraIssueStatus) => void;
}) {
  const t = useT();
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<PickerState | null>(null);

  async function loadTransitions() {
    setState({ phase: "loading" });
    try {
      setState({ phase: "choices", transitions: await jiraIssueTransitions(issueKey) });
    } catch (reason) {
      setState({ phase: "error", message: errorText(reason), saved: false });
    }
  }

  async function refreshStatus() {
    setState({ phase: "saving" });
    try {
      const { status: current } = await jiraIssueDetails(issueKey);
      if (!current?.state || !current.statusId)
        throw new Error(t("Jira did not return the issue status."));
      onChange(current);
      setOpen(false);
      setState(null);
    } catch (reason) {
      setState({ phase: "error", message: errorText(reason), saved: true });
    }
  }

  async function changeStatus(transition: JiraTransition) {
    if (state?.phase !== "choices" || transition.requiresFields) return;
    setState({ phase: "saving" });
    try {
      await jiraTransitionIssue(issueKey, transition.id);
    } catch (reason) {
      setState({ phase: "error", message: errorText(reason), saved: false });
      return;
    }
    await refreshStatus();
  }

  const saving = state?.phase === "saving";
  const showJiraLink =
    state?.phase === "error" ||
    (state?.phase === "choices" &&
      (state.transitions.length === 0 ||
        state.transitions.some((transition) => transition.requiresFields)));
  return (
    <>
      <Button
        ref={trigger}
        type="button"
        variant="ghost"
        size="xs"
        padding={{ inline: "xs" }}
        tone={mark.tone}
        aria-label={`${t("Change status")} · ${status}`}
        aria-haspopup="dialog"
        expanded={open}
        loading={saving}
        onClick={() => {
          setOpen(!open);
          if (!open && state?.phase !== "loading" && !(state?.phase === "error" && state.saved))
            void loadTransitions();
        }}
      >
        <mark.Icon className="icon-sm" strokeWidth={1.75} aria-hidden="true" />
        {status}
      </Button>
      {open ? (
        <Popover
          kind="dialog"
          aria-label={t("Change status")}
          anchor={trigger}
          align="start"
          size="sm"
          flow="scroll"
          solid
          onDismiss={saving ? undefined : () => setOpen(false)}
        >
          <div className="flex flex-col gap-1 p-2">
            <Text size="caption" tone="secondary" className="px-2 py-1">
              {t("Change status")}
            </Text>
            {state?.phase === "loading" || saving ? <LoadingText /> : null}
            {state?.phase === "choices" ? (
              state.transitions.length ? (
                state.transitions.map((transition) => (
                  <Button
                    key={transition.id}
                    type="button"
                    variant="item"
                    align="start"
                    disabled={transition.requiresFields}
                    disabledReason={t("This transition needs fields. Change it in Jira.")}
                    onClick={() => void changeStatus(transition)}
                  >
                    {transition.name}
                    {transition.statusName && transition.statusName !== transition.name
                      ? ` · ${transition.statusName}`
                      : ""}
                    {transition.requiresFields ? ` · ${t("Requires fields in Jira")}` : ""}
                  </Button>
                ))
              ) : (
                <EmptyState
                  size="inline"
                  context="list"
                  description={t("No Jira transitions available.")}
                />
              )
            ) : null}
            {state?.phase === "error" ? (
              <InlineError
                details={state.message}
                retry={{
                  onRetry: () => void (state.saved ? refreshStatus() : loadTransitions()),
                  label: state.saved ? t("Retry refresh") : undefined,
                }}
              >
                {state.saved ? t("Saved to Jira. Could not refresh the status.") : undefined}
              </InlineError>
            ) : null}
            {showJiraLink && url ? (
              <Button
                type="button"
                variant="ghost"
                align="start"
                onClick={() => openUrlSafely(url)}
              >
                <ExternalLink className="icon-sm" strokeWidth={1.75} aria-hidden="true" />
                {t("Open in Jira")}
              </Button>
            ) : null}
          </div>
        </Popover>
      ) : null}
    </>
  );
}
