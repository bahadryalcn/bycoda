import { useSocialPending } from "./useSocialPending";
import { useContext as useSocialContext } from "react";
import { SocialBusyContext as SocialLockContext } from "./socialContext";
import { t, useLocale } from "../../../shared/i18n";
import { Alert } from "../../../shared/ui/Alert";
import { NativeSelect } from "../../../shared/ui/Select";
import { NumberField } from "../../../shared/ui/NumberField";
import { Button } from "../../../shared/ui/Button";
import { useRef, useState } from "react";
import { Notice } from "./socialShared";
import { SocialModelField } from "./SocialModelField";
import { HARNESS_TITLE } from "../../sessions/model/session";
import {
  SOCIAL_PLATFORMS,
  SOCIAL_PLATFORM_NAMES,
  type SocialPolicies,
  type SocialPlatform,
  type SocialPolicy,
} from "../model/social";
import {
  DEFAULT_SOCIAL_POLICIES,
  effectiveSocialPolicy,
  parseSocialPolicies,
  SOCIAL_LIMIT_FIELDS,
} from "../model/socialPolicy";
import type { SocialClient } from "../model/socialClient";

const labels = {
  get maxContentCharacters() {
    return t("Post character limit");
  },
  get maxCommentCharacters() {
    return t("Comment and reply character limit");
  },
  get maxMessageCharacters() {
    return t("Message character limit");
  },
};
const platforms = SOCIAL_PLATFORM_NAMES;
type Scope = "global" | SocialPlatform;
type Limits = Record<(typeof SOCIAL_LIMIT_FIELDS)[number], string>;
type Draft = {
  base: SocialPolicy;
  provider: string;
  model: string;
  limits: Limits;
};
function draftFor(base: SocialPolicy): Draft {
  return {
    base,
    provider: base.agent?.provider ?? "",
    model: base.agent?.model ?? "",
    limits: Object.fromEntries(
      SOCIAL_LIMIT_FIELDS.map((field) => [field, String(base[field] ?? "")]),
    ) as Limits,
  };
}
function policyKey(policy: SocialPolicy) {
  return JSON.stringify([
    policy.agent?.provider,
    policy.agent?.model,
    ...SOCIAL_LIMIT_FIELDS.map((field) => policy[field]),
  ]);
}
function isEdited(draft: Draft) {
  const original = draftFor(draft.base);
  return (
    draft.provider !== original.provider ||
    draft.model !== original.model ||
    SOCIAL_LIMIT_FIELDS.some((field) => draft.limits[field] !== original.limits[field])
  );
}
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function SocialPolicySettings({
  client,
  policies = DEFAULT_SOCIAL_POLICIES,
  run,
  executorLabel,
}: {
  client: SocialClient;
  policies?: SocialPolicies;
  run: (action: () => Promise<unknown>) => Promise<boolean>;
  executorLabel?: string;
}) {
  const pendingUi = useSocialPending();
  const socialLocked = useSocialContext(SocialLockContext);
  useLocale();
  const [scope, setScope] = useState<Scope>("global");
  const [drafts, setDrafts] = useState<Partial<Record<Scope, Draft>>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const savingRef = useRef(false);
  const value = scope === "global" ? policies.global : (policies.platforms[scope] ?? {});
  // Refreshes may update other scopes during editing: only edited drafts are preserved,
  // unedited ones always read the current saved value.
  const keptDraft = (stored: Draft | undefined) =>
    stored && isEdited(stored) ? stored : draftFor(value);
  const draft = keptDraft(drafts[scope]);
  const conflict = isEdited(draft) && policyKey(draft.base) !== policyKey(value);
  const effective = scope === "global" ? policies.global : effectiveSocialPolicy(policies, scope);

  const update = (changes: Partial<Omit<Draft, "base">>) => {
    setDrafts((current) => ({
      ...current,
      [scope]: { ...keptDraft(current[scope]), ...changes },
    }));
    setError("");
    setNotice("");
  };
  const reset = () => {
    setDrafts((current) => {
      const next = { ...current };
      delete next[scope];
      return next;
    });
    setError("");
    setNotice(t("Saved settings loaded."));
  };

  return (
    <section
      className="social-policy-panel"
      aria-label={t("Social media agent and content settings")}
    >
      <h2>{t("AI and content")}</h2>
      {executorLabel ? (
        <p className="text-ui-caption text-(--ui-text-secondary)">
          {t("Settings for computer: {p0}", { p0: executorLabel })}
        </p>
      ) : null}
      <label className="social-policy-scope">
        {t("Settings scope")}
        <NativeSelect
          value={scope}
          disabled={saving || socialLocked || saving}
          onChange={(event) => {
            setScope(event.target.value as Scope);
            setError("");
            setNotice("");
          }}
        >
          <option value="global">{t("All platforms")}</option>
          {SOCIAL_PLATFORMS.map((platform) => (
            <option key={platform} value={platform}>
              {platforms[platform]}
            </option>
          ))}
        </NativeSelect>
      </label>
      <p className="social-policy-effective">
        {t("Saved agent")}:{" "}
        {effective.agent
          ? `${HARNESS_TITLE[effective.agent.provider]} · ${effective.agent.model || t("default model")}`
          : t("AI off · verified fixed reply")}
        {scope !== "global" && !policies.platforms[scope]?.agent ? ` · ${t("shared setting")}` : ""}
      </p>
      {isEdited(draft) ? (
        <p role="status" className="text-ui-caption text-(--ui-tone-warning-fg)">
          {t("Unsaved changes · the saved policy remains active.")}
        </p>
      ) : null}
      {conflict ? (
        <Alert tone="danger">
          {t(
            "These settings were updated in another session. Your edited values are preserved. Load the saved settings to continue.",
          )}
        </Alert>
      ) : null}
      <form
        className="social-form"
        aria-busy={saving}
        onSubmit={(event) => {
          event.preventDefault();
          if (savingRef.current || conflict) return;
          const data = new FormData(event.currentTarget);
          const policy: SocialPolicy = {};
          if (draft.provider)
            policy.agent = {
              provider: draft.provider as NonNullable<SocialPolicy["agent"]>["provider"],
              ...(draft.model.trim() ? { model: draft.model.trim() } : {}),
            };
          for (const field of SOCIAL_LIMIT_FIELDS) {
            const raw = String(data.get(field) ?? "").trim();
            if (raw) {
              const limit = Number(raw);
              if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20_000) {
                setError(
                  t("{p0} must be a whole number between 1 and 20000.", { p0: labels[field] }),
                );
                return;
              }
              policy[field] = limit;
            }
          }
          let next: SocialPolicies;
          try {
            next = parseSocialPolicies(
              scope === "global"
                ? { ...policies, global: policy }
                : {
                    ...policies,
                    platforms: { ...policies.platforms, [scope]: policy },
                  },
            );
          } catch {
            setError(
              t("Check the agent and model name. The model name can be at most 200 characters."),
            );
            return;
          }
          const savedScope = scope;
          savingRef.current = true;
          setSaving(true);
          setError("");
          setNotice("");
          let started = false;
          void pendingUi
            .run("policy.save", () =>
              run(async () => {
                started = true;
                try {
                  await client.request("policy.save", { policies: next });
                  setDrafts((current) => ({
                    ...current,
                    [savedScope]: draftFor(policy),
                  }));
                  setNotice(
                    savedScope === "global"
                      ? t("Shared settings saved.")
                      : t("{p0} settings saved.", { p0: platforms[savedScope] }),
                  );
                } catch (error) {
                  setError(t("Settings could not be saved: {p0}", { p0: errorText(error) }));
                  throw error;
                }
              }),
            )
            .then((success) => {
              if (!success && !started)
                setError(t("Another operation is in progress. Try saving again."));
            })
            .catch((error) =>
              setError(t("Settings could not be saved: {p0}", { p0: errorText(error) })),
            )
            .finally(() => {
              savingRef.current = false;
              setSaving(false);
            });
        }}
      >
        <fieldset className="social-workspace">
          <SocialModelField
            label={t("AI agent and model")}
            inheritLabel={
              scope === "global" ? t("Do not use AI") : t("Use the shared agent setting")
            }
            disabled={saving || socialLocked}
            value={{ provider: draft.provider, model: draft.model }}
            onChange={(next) => update(next)}
          />
          <section className="social-policy-limits">
            <h3>{t("Character limits")}</h3>
            <div className="social-field-grid">
              {SOCIAL_LIMIT_FIELDS.map((field) => (
                <NumberField
                  disabled={saving || socialLocked}
                  key={field}
                  label={labels[field]}
                  name={field}
                  min={1}
                  max={20000}
                  step={1}
                  value={draft.limits[field]}
                  onChange={(event) =>
                    update({
                      limits: { ...draft.limits, [field]: event.target.value },
                    })
                  }
                  placeholder={
                    scope !== "global" && policies.global[field]
                      ? t("Shared limit: {p0}", { p0: policies.global[field] })
                      : t("No additional limit")
                  }
                  description={
                    t("Saved limit: {p0}", { p0: effective[field] ?? t("no extra limit") }) +
                    (scope !== "global" && policies.platforms[scope]?.[field] === undefined
                      ? ` · ${t("shared setting")}`
                      : "")
                  }
                />
              ))}
            </div>
            <p className="text-ui-caption text-(--ui-text-secondary)">
              {t(
                "These are additional policy limits. Platform limits and send approval still apply.",
              )}
            </p>
          </section>
          <div className="social-actions">
            <Button
              variant="primary"
              type="submit"
              disabled={saving || socialLocked || conflict}
              loading={pendingUi.is("policy.save")}
            >
              {saving ? t("Saving…") : t("Save settings")}
            </Button>
            {isEdited(draft) || conflict ? (
              <Button
                disabled={saving || socialLocked}
                variant="secondary"
                type="button"
                onClick={reset}
              >
                {t("Discard edits and load saved settings")}
              </Button>
            ) : null}
          </div>
        </fieldset>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {notice ? <Notice kind="success" title={notice} /> : null}
        <details className="social-settings">
          <summary>{t("How are these settings applied?")}</summary>
          <p className="social-muted">
            {t(
              "Platform limits and send approval still apply. If the selected agent is unavailable, no other agent is used.",
            )}
          </p>
        </details>
      </form>
    </section>
  );
}
