import { InlineError } from "../../../../shared/ui/InlineError";
import { useState } from "react";
import { t } from "../../../../shared/i18n";
import { Group, Row } from "../../../settings/public/settingsControls";
import { Select } from "../../../../shared/ui/Select";

import { TextField } from "../../../../shared/ui/TextField";
import { DisabledReason } from "../common/DisabledReason";
import { PlatformIcon } from "../common/PlatformIcon";
import {
  SOCIAL_PLATFORMS,
  SOCIAL_PLATFORM_NAMES,
  type SocialPolicies,
  type SocialPolicy,
} from "../../model/social";
import type { SocialClient } from "../../model/socialClient";
import { parseCharacterLimit } from "./accountsModel";
import { effectiveForScope, readScope, type PolicyScope } from "./policyScope";
import { savePolicyScope } from "./savePolicy";
import { useAccountWrite } from "./useAccountWrite";
import "./accounts.css";

export type CharacterLimitsProps = {
  client: SocialClient;
  policies: SocialPolicies;
  onChanged(): void;
};

type LimitKey = "maxContentCharacters" | "maxCommentCharacters" | "maxMessageCharacters";

function limitFields(): { key: LimitKey; label: string }[] {
  return [
    { key: "maxContentCharacters", label: t("Post length") },
    { key: "maxCommentCharacters", label: t("Comment length") },
    { key: "maxMessageCharacters", label: t("Message length") },
  ];
}

type Drafts = Record<LimitKey, string>;

function draftsOf(stored: SocialPolicy): Drafts {
  return {
    maxContentCharacters: stored.maxContentCharacters?.toString() ?? "",
    maxCommentCharacters: stored.maxCommentCharacters?.toString() ?? "",
    maxMessageCharacters: stored.maxMessageCharacters?.toString() ?? "",
  };
}

/** Character limits for posts, comments and messages, per scope. A blank field inherits. */
export function CharacterLimits({ client, policies, onChanged }: CharacterLimitsProps) {
  const [scope, setScope] = useState<PolicyScope>("global");
  // Unsaved edits live here per scope, so switching scope or a saved change elsewhere keeps them.
  const [unsaved, setUnsaved] = useState<Partial<Record<PolicyScope, Drafts>>>({});
  return (
    <Group
      title={t("Character limits")}
      description={t("Leave a field blank to inherit its value.")}
      action={
        <Select
          hideLabel
          label={t("Apply to")}
          value={scope}
          options={[
            { value: "global", label: t("All accounts") },
            ...SOCIAL_PLATFORMS.map((platform) => ({
              value: platform,
              label: SOCIAL_PLATFORM_NAMES[platform],
              icon: <PlatformIcon platform={platform} />,
            })),
          ]}
          onValueChange={(value) => setScope(value as PolicyScope)}
        />
      }
    >
      <Row label={t("Maximum length")} stacked>
        <LimitFields
          key={`${scope}:${JSON.stringify(readScope(policies, scope))}`}
          client={client}
          policies={policies}
          scope={scope}
          unsaved={unsaved[scope]}
          onUnsavedChange={(drafts) => setUnsaved((current) => ({ ...current, [scope]: drafts }))}
          onSaved={() => setUnsaved(({ [scope]: _saved, ...rest }) => rest)}
          onChanged={onChanged}
        />
      </Row>
    </Group>
  );
}

function LimitFields({
  client,
  policies,
  scope,
  unsaved,
  onUnsavedChange,
  onSaved,
  onChanged,
}: CharacterLimitsProps & {
  scope: PolicyScope;
  unsaved: Drafts | undefined;
  onUnsavedChange(drafts: Drafts): void;
  onSaved(): void;
}) {
  const stored = readScope(policies, scope);
  const effective = effectiveForScope(policies, scope);
  const fields = limitFields();
  const [drafts, setDrafts] = useState<Drafts>(() => unsaved ?? draftsOf(stored));
  const [localError, setLocalError] = useState("");
  const { error, is, write } = useAccountWrite(t("The limits could not be saved. Try again."));

  const edit = (key: LimitKey, value: string) => {
    const next = { ...drafts, [key]: value };
    setDrafts(next);
    onUnsavedChange(next);
  };

  const save = () => {
    // Every field is checked before any request: an invalid value never reaches the Host.
    const next: SocialPolicy = { ...stored };
    for (const field of fields) {
      const result = parseCharacterLimit(drafts[field.key]);
      if (!result.ok) {
        setLocalError(result.message);
        return;
      }
      if (result.value === undefined) delete next[field.key];
      else next[field.key] = result.value;
    }
    setLocalError("");
    void write("policy.limits", () => savePolicyScope(client, policies, scope, next))
      .then((result) => {
        if (result === undefined) return;
        onSaved();
        onChanged();
      })
      .catch(() => undefined);
  };

  return (
    <form
      className="social-limit-form"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      {fields.map((field) => (
        <TextField
          key={field.key}
          label={field.label}
          numeric
          inputMode="numeric"
          value={drafts[field.key]}
          placeholder={effective[field.key]?.toString() ?? ""}
          disabled={is("policy.limits")}
          onChange={(event) => {
            // Read the DOM value now: React clears currentTarget once the handler returns.
            const value = event.currentTarget.value;
            edit(field.key, value);
          }}
        />
      ))}
      <DisabledReason type="submit" variant="secondary" size="sm" loading={is("policy.limits")}>
        {t("Save limits")}
      </DisabledReason>
      {localError || error ? <InlineError>{localError || error}</InlineError> : null}
    </form>
  );
}
