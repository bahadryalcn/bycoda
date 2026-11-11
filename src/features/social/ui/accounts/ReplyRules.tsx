import { useCallback, useEffect, useState } from "react";
import { t } from "../../../../shared/i18n";
import { useConfirm } from "../../../../shared/ui/ConfirmDialog";
import { Heading } from "../../../../shared/ui/Heading";
import { InlineMessage } from "../../../../shared/ui/InlineError";
import { Switch } from "../../../../shared/ui/Switch";
import type { HostProject } from "../../../connections/public/protocol";
import type { SocialAccount, SocialRule } from "../../model/social";
import type { RuleSimplifySuggestion } from "../../model/socialSuggestions";
import type { SocialClient } from "../../model/socialClient";
import { DisabledReason, gateProps, type ActionGate } from "../common/DisabledReason";
import { useAccountWrite } from "./useAccountWrite";
import "./accounts.css";

export type ReplyRulesProps = {
  client: SocialClient;
  account: SocialAccount;
  projects: HostProject[];
  disabled: boolean;
};

function modeText(mode: SocialRule["mode"]): string {
  switch (mode) {
    case "draft":
      return t("Draft for review");
    case "approval":
      return t("Ask me first");
    case "automatic":
      return t("Automatic");
  }
}

function triggerText(trigger: SocialRule["trigger"]): string {
  return trigger === "comment" ? t("Comments") : t("Messages");
}

/**
 * Reply rules of one account: turn each on or off, and ask AI to narrow them. Narrowing only
 * proposes; the owner edits and activates rules, and an automatic rule asks for confirmation first.
 */
export function ReplyRules({ client, account, projects, disabled }: ReplyRulesProps) {
  const [rules, setRules] = useState<SocialRule[]>();
  const [loadError, setLoadError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [proposal, setProposal] = useState<RuleSimplifySuggestion>();
  const { error, is, write } = useAccountWrite(t("The rule could not be changed. Try again."));
  const confirmation = useConfirm();

  useEffect(() => {
    let alive = true;
    client.sectionSnapshot({ section: "rules" }).then(
      (response) => {
        if (!alive) return;
        setLoadError("");
        setRules((response.snapshot?.rules ?? []).filter((rule) => rule.accountId === account.id));
      },
      () => {
        if (alive) setLoadError(t("The reply rules could not be read. Try again."));
      },
    );
    return () => {
      alive = false;
    };
  }, [account.id, attempt, client]);

  const reload = useCallback(() => setAttempt((value) => value + 1), []);
  const projectId = rules?.[0]?.projectId ?? projects[0]?.id;
  const reviewGate: ActionGate = disabled
    ? { disabled: true, disabledReason: t("Connect to this computer to change this account.") }
    : is("simplify")
      ? { disabled: true, disabledReason: t("Working…") }
      : !rules
        ? { disabled: true, disabledReason: t("Loading…") }
        : !rules.length
          ? { disabled: true, disabledReason: t("No reply rules for this account yet.") }
          : !projectId
            ? { disabled: true, disabledReason: t("Choose a project first.") }
            : { disabled: false };

  const setEnabled = (rule: SocialRule, enabled: boolean) => {
    if (enabled && rule.mode === "automatic") {
      void confirmation
        .confirm({
          title: t("Turn on {p1}?", { p1: rule.name }),
          message: t("This rule sends replies without asking you first."),
          confirmLabel: t("Turn on rule"),
          danger: false,
        })
        .then((ok) => {
          if (ok) activate(rule);
        })
        .catch(() => undefined);
      return;
    }
    if (enabled) activate(rule);
    else
      void write(`rule:${rule.id}`, () => client.request("automations.pause", { id: rule.id }))
        .then((result) => result !== undefined && reload())
        .catch(() => undefined);
  };

  const activate = (rule: SocialRule) =>
    void write(`rule:${rule.id}`, () =>
      client.request("automations.activate", {
        id: rule.id,
        ...(rule.mode === "automatic" ? { confirm: "ENABLE_AUTOMATIC_REPLIES" } : {}),
      }),
    )
      .then((result) => result !== undefined && reload())
      .catch(() => undefined);

  const review = () =>
    void write("simplify", () =>
      client.request<RuleSimplifySuggestion>("rules.simplify", {
        accountId: account.id,
        projectId,
        ruleIds: rules?.map((rule) => rule.id),
      }),
    )
      .then((result) => result !== undefined && setProposal(result))
      .catch(() => undefined);

  return (
    <section className="social-card" aria-label={t("Reply rules")}>
      <div className="social-card-head">
        <Heading size="item">{t("Reply rules")}</Heading>
        <DisabledReason
          variant="secondary"
          size="sm"
          loading={is("simplify")}
          onClick={review}
          {...gateProps(reviewGate)}
        >
          {t("Review rules with AI")}
        </DisabledReason>
      </div>
      {loadError ? (
        <InlineMessage tone="danger" retry={{ onRetry: reload, label: t("Try again") }}>
          {loadError}
        </InlineMessage>
      ) : null}
      {rules && !rules.length ? (
        <p className="social-muted">{t("No reply rules for this account yet.")}</p>
      ) : null}
      {rules?.map((rule) => (
        <div key={rule.id} className="social-field-row">
          <Switch
            label={rule.name}
            checked={rule.enabled}
            disabled={disabled || is(`rule:${rule.id}`)}
            onCheckedChange={(enabled) => setEnabled(rule, enabled)}
          />
          <span className="social-muted">
            {triggerText(rule.trigger)} · {modeText(rule.mode)}
          </span>
          {rule.pausedReason && !rule.enabled ? (
            <span className="social-muted">{t("Paused")}</span>
          ) : null}
        </div>
      ))}
      {proposal ? (
        <div className="social-card">
          <p className="social-card-description">
            {t("AI suggests these narrower rules. Nothing changes until you edit a rule.")}
          </p>
          {proposal.proposals.length ? (
            <ul>
              {proposal.proposals.map((item) => (
                <li key={item.ruleId}>
                  <strong>{item.ruleName}</strong>: {item.reason}
                </li>
              ))}
            </ul>
          ) : (
            <p className="social-muted">{t("No rule needs narrowing.")}</p>
          )}
          {proposal.notes.map((note) => (
            <p key={note} className="social-muted">
              {note}
            </p>
          ))}
        </div>
      ) : null}
      {error ? <InlineMessage tone="danger">{error}</InlineMessage> : null}
      {confirmation.dialog}
    </section>
  );
}
