import { useCallback, useEffect, useState } from "react";
import { t } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";
import { useConfirm } from "../../../../shared/ui/ConfirmDialog";
import { InlineError } from "../../../../shared/ui/InlineError";
import { SectionLabel } from "../../../../shared/ui/SectionLabel";
import { Switch } from "../../../../shared/ui/Switch";
import type { CaptureRule, SocialList } from "../../model/audience";
import type { SocialAccount } from "../../model/social";
import type { Sequence } from "../../model/outreach";
import type { SocialClient } from "../../model/socialClient";
import { EmptyHint } from "../common/EmptyHint";
import { PlatformMark } from "../common/PlatformIcon";
import { captureSourceLabel } from "./findPeopleSource";
import { CaptureRuleForm } from "./CaptureRuleForm";
import { errorMessage, isCommentersList } from "./audienceModel";
import "./audience.css";

export type CaptureRulesProps = {
  client: SocialClient;
  accounts: readonly SocialAccount[];
  lists: readonly SocialList[];
  onChanged: () => void;
};

/**
 * Rules that collect people automatically. A rule is saved turned off; turning it on is a
 * separate step, and the Host refuses it unless the owner or the autonomy policy allows it.
 */
export function CaptureRules({ client, accounts, lists, onChanged }: CaptureRulesProps) {
  const { confirm, dialog } = useConfirm();
  const [rules, setRules] = useState<CaptureRule[]>();
  const [sequences, setSequences] = useState<Sequence[]>([]);
  const [error, setError] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string>();

  const load = useCallback(() => {
    Promise.all([client.captureRules.list(), client.sequences.list()])
      .then(([ruleResult, sequenceResult]) => {
        setError(undefined);
        setRules(ruleResult.items);
        setSequences(sequenceResult.items);
      })
      .catch((err: unknown) => setError(errorMessage(err)));
  }, [client]);

  useEffect(() => {
    load();
  }, [load]);

  const commenters = rules?.find((rule) => rule.system === "commenters");
  const commentersList = lists.find(isCommentersList);
  const listName = (listId: string) => lists.find((list) => list.id === listId)?.name ?? "";

  async function setEnabled(rule: CaptureRule, enabled: boolean) {
    setBusyId(rule.id);
    setError(undefined);
    try {
      const updated = await client.captureRules.setEnabled({ id: rule.id, enabled });
      // Merge over the row we already hold so a partial echo never drops system or source fields.
      setRules((current) =>
        current?.map((item) => (item.id === rule.id ? { ...item, ...updated } : item)),
      );
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyId(undefined);
    }
  }

  async function remove(rule: CaptureRule) {
    const ok = await confirm({
      title: t("Delete this rule?"),
      message: t("New people will no longer be collected by it. People already collected stay."),
      confirmLabel: t("Delete rule"),
      danger: true,
    });
    if (!ok) return;
    try {
      await client.captureRules.delete(rule.id);
      setRules((current) => current?.filter((item) => item.id !== rule.id));
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const others = (rules ?? []).filter((rule) => rule.system !== "commenters");

  return (
    <div className="audience-stack">
      <section className="audience-section" aria-labelledby="ready-rule-heading">
        <SectionLabel labelId="ready-rule-heading">{t("Ready-made rule")}</SectionLabel>
        <div className="audience-frame">
          <div className="audience-rule">
            <div className="audience-rule-text">
              <span>{t("Add the people who comment on my posts to the Commenters list.")}</span>
              {!commenters ? (
                <span className="audience-caption">
                  {commentersList
                    ? t("This rule is not set up on this computer yet.")
                    : t("The Commenters list is not set up on this computer yet.")}
                </span>
              ) : null}
            </div>
            {commenters ? (
              <Switch
                label={commenters.enabled ? t("On") : t("Off")}
                checked={commenters.enabled}
                disabled={busyId === commenters.id}
                onCheckedChange={(enabled) =>
                  void setEnabled(commenters, enabled).catch(() => undefined)
                }
              />
            ) : null}
          </div>
        </div>
      </section>

      <div className="audience-row audience-between">
        <SectionLabel>{t("Your rules")}</SectionLabel>
        <Button variant="secondary" size="sm" onClick={() => setCreating(true)}>
          {t("New rule")}
        </Button>
      </div>

      {error ? <InlineError>{error}</InlineError> : null}
      {rules === undefined && !error ? (
        <p className="audience-muted">{t("Loading rules…")}</p>
      ) : null}
      {rules && !others.length ? (
        <EmptyHint message={t("No rules yet. A rule adds people to a list as they interact.")} />
      ) : null}
      {others.length ? (
        <ul className="audience-frame">
          {others.map((rule) => {
            const platform = accounts.find(
              (account) => account.id === rule.source.accountId,
            )?.platform;
            return (
              <li key={rule.id} className="audience-rule">
                <div className="audience-rule-text">
                  <strong className="audience-strong">{rule.name}</strong>
                  <span className="audience-caption audience-trigger">
                    {platform ? <PlatformMark platform={platform} size="xs" tooltip /> : null}
                    {t("{p0} → {p1}", {
                      p0: captureSourceLabel(rule.source.kind),
                      p1: listName(rule.targetListId) || t("No list"),
                    })}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    void remove(rule).catch((err: unknown) => setError(errorMessage(err)))
                  }
                >
                  {t("Delete rule")}
                </Button>
                <Switch
                  label={rule.enabled ? t("On") : t("Off")}
                  checked={rule.enabled}
                  disabled={busyId === rule.id}
                  onCheckedChange={(enabled) =>
                    void setEnabled(rule, enabled).catch(() => undefined)
                  }
                />
              </li>
            );
          })}
        </ul>
      ) : null}

      {creating ? (
        <CaptureRuleForm
          client={client}
          accounts={accounts}
          lists={lists}
          sequences={sequences}
          onClose={() => setCreating(false)}
          onSaved={(rule) => {
            setRules((current) => [...(current ?? []), rule]);
            onChanged();
          }}
        />
      ) : null}
      {dialog}
    </div>
  );
}
