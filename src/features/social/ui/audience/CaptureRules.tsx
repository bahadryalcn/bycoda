import { LoadingText } from "../../../../shared/ui/LoadingText";
import { Text } from "../../../../shared/ui/Text";
import { useCallback, useEffect, useState } from "react";
import { t } from "../../../../shared/i18n";
import { ActionHost, InlineMoreAction } from "../../../../shared/ui/ActionHost";
import { Badge } from "../../../../shared/ui/Badge";
import { Button } from "../../../../shared/ui/Button";
import { useConfirm } from "../../../../shared/ui/ConfirmDialog";
import { DropdownMenu } from "../../../../shared/ui/DropdownMenu";
import { InlineError } from "../../../../shared/ui/InlineError";
import { Plus } from "../../../../shared/ui/icons";
import { SectionLabel } from "../../../../shared/ui/SectionLabel";
import { Surface, surfaceAttributes } from "../../../../shared/ui/Surface";
import { Switch } from "../../../../shared/ui/Switch";
import type { CaptureRule, SocialList } from "../../model/audience";
import type { SocialAccount } from "../../model/social";
import type { Sequence } from "../../model/outreach";
import type { SocialClient } from "../../model/socialClient";
import { EmptyHint } from "../common/EmptyHint";
import { PlatformMark } from "../common/PlatformIcon";
import { captureSourceLabel } from "./findPeopleSource";
import { CaptureRuleForm } from "./CaptureRuleForm";
import {
  errorMessage,
  isCommentersList,
  listDisplayName,
  ruleConditionSummary,
} from "./audienceModel";
import "./audience.css";

export type CaptureRulesProps = {
  client: SocialClient;
  accounts: readonly SocialAccount[];
  lists: readonly SocialList[];
  onChanged: () => void;
};

type RuleMenu = { ruleId: string; anchor: HTMLButtonElement };

/**
 * Rules that collect people automatically. A new rule is saved turned off; turning it on is a
 * separate step, and the Host refuses it unless the owner or the autonomy policy allows it.
 * Each custom rule shows where it reads from, which people it keeps, the list it fills and its
 * next step, and can be edited or deleted from its menu.
 */
export function CaptureRules({ client, accounts, lists, onChanged }: CaptureRulesProps) {
  const { confirm, dialog } = useConfirm();
  const [rules, setRules] = useState<CaptureRule[]>();
  const [sequences, setSequences] = useState<Sequence[]>([]);
  const [error, setError] = useState<string>();
  const [editing, setEditing] = useState<CaptureRule | "new">();
  const [busyId, setBusyId] = useState<string>();
  const [menu, setMenu] = useState<RuleMenu | null>(null);

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
  const others = (rules ?? []).filter((rule) => rule.system !== "commenters");
  const menuRule = menu ? others.find((rule) => rule.id === menu.ruleId) : undefined;

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
      pendingLabel: t("Deleting…"),
      danger: true,
      onConfirm: async () => {
        await client.captureRules.delete(rule.id);
      },
    });
    if (!ok) return;
    setRules((current) => current?.filter((item) => item.id !== rule.id));
    onChanged();
  }

  function pickMenu(id: string) {
    const rule = menuRule;
    setMenu(null);
    if (!rule) return;
    if (id === "edit") setEditing(rule);
    else if (id === "delete")
      void remove(rule).catch((err: unknown) => setError(errorMessage(err)));
  }

  function nextStep(rule: CaptureRule): string | undefined {
    if (rule.action?.kind === "tag") return t("Then adds the tag {p0}", { p0: rule.action.tag });
    if (rule.action?.kind === "enroll") {
      const sequenceId = rule.action.sequenceId;
      const sequence = sequences.find((item) => item.id === sequenceId);
      return t("Then starts the sequence {p0}", { p0: sequence?.name ?? t("(deleted)") });
    }
    return undefined;
  }

  function ruleRow(rule: CaptureRule, index: number) {
    const account = accounts.find((item) => item.id === rule.source.accountId);
    const target = lists.find((list) => list.id === rule.targetListId);
    const conditions = ruleConditionSummary(rule.filter);
    const step = nextStep(rule);
    return (
      <ActionHost
        as="li"
        key={rule.id}
        {...surfaceAttributes(
          { frame: index > 0 ? "pane" : undefined, edge: "block-start" },
          "audience-rule",
        )}
      >
        {account ? <PlatformMark platform={account.platform} size="md" tooltip /> : null}
        <div className="audience-rule-text">
          <Text
            as="strong"
            size="inherit"
            tone="primary"
            leading="inherit"
            weight="medium"
            truncate
          >
            {rule.name}
          </Text>
          <Text as="span" tone="muted" leading="inherit" truncate>
            {account
              ? t("{p0} on {p1}", { p0: captureSourceLabel(rule.source.kind), p1: account.name })
              : captureSourceLabel(rule.source.kind)}
          </Text>
          <Text as="span" tone="muted" leading="inherit">
            {conditions.length ? conditions.join("; ") : t("Everyone who matches the source")}
          </Text>
          <Text as="span" tone="muted" leading="inherit">
            {target
              ? t("Adds to {p0}", { p0: listDisplayName(target) })
              : t("The list it adds to no longer exists")}
            {step ? `. ${step}` : ""}
          </Text>
        </div>
        {target ? null : (
          <Badge size="sm" tone="warning">
            {t("List missing")}
          </Badge>
        )}
        <Switch
          label={rule.enabled ? t("On") : t("Off")}
          checked={rule.enabled}
          disabled={busyId === rule.id}
          onCheckedChange={(enabled) => void setEnabled(rule, enabled).catch(() => undefined)}
        />
        <InlineMoreAction
          reveal="always"
          label={t("Actions for {p0}", { p0: rule.name })}
          expanded={menu?.ruleId === rule.id}
          onOpen={(anchor) => setMenu({ ruleId: rule.id, anchor })}
        />
      </ActionHost>
    );
  }

  return (
    <div className="audience-stack">
      <section className="audience-section" aria-labelledby="ready-rule-heading">
        <SectionLabel labelId="ready-rule-heading">{t("Ready-made rule")}</SectionLabel>
        <Surface variant="card" padding="none" className="audience-frame">
          <div className="audience-rule">
            <div className="audience-rule-text">
              <span>{t("Add the people who comment on my posts to the Commenters list.")}</span>
              {!commenters ? (
                <Text as="span" tone="muted" leading="inherit">
                  {commentersList
                    ? t("This rule is not set up on this computer yet.")
                    : t("The Commenters list is not set up on this computer yet.")}
                </Text>
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
        </Surface>
      </section>

      <SectionLabel
        count={others.length || undefined}
        actions={
          others.length ? (
            <Button
              variant="secondary"
              size="sm"
              startIcon={<Plus className="icon-sm" aria-hidden="true" />}
              onClick={() => setEditing("new")}
            >
              {t("New rule")}
            </Button>
          ) : undefined
        }
      >
        {t("Your rules")}
      </SectionLabel>

      {error ? <InlineError>{error}</InlineError> : null}
      {rules === undefined && !error ? (
        <LoadingText delay={false} className="audience-muted">
          {t("Loading rules…")}
        </LoadingText>
      ) : null}
      {rules && !others.length ? (
        <EmptyHint
          message={t("No rules yet. A rule adds people to a list as they interact.")}
          action={{ label: t("New rule"), onClick: () => setEditing("new") }}
        />
      ) : null}
      {others.length ? (
        <Surface as="ul" variant="card" padding="none" className="audience-frame">
          {others.map(ruleRow)}
        </Surface>
      ) : null}

      {menu && menuRule ? (
        <DropdownMenu
          anchor={menu.anchor}
          label={t("Actions for {p0}", { p0: menuRule.name })}
          items={[
            { kind: "item", id: "edit", label: t("Edit rule…") },
            { kind: "sep" },
            { kind: "item", id: "delete", label: t("Delete rule…"), danger: true },
          ]}
          onPick={pickMenu}
          onClose={() => setMenu(null)}
        />
      ) : null}
      {editing ? (
        <CaptureRuleForm
          client={client}
          accounts={accounts}
          lists={lists}
          sequences={sequences}
          rule={editing === "new" ? undefined : editing}
          onClose={() => setEditing(undefined)}
          onSaved={(saved) => {
            setRules((current) =>
              current?.some((item) => item.id === saved.id)
                ? current.map((item) => (item.id === saved.id ? saved : item))
                : [...(current ?? []), saved],
            );
            onChanged();
          }}
        />
      ) : null}
      {dialog}
    </div>
  );
}
