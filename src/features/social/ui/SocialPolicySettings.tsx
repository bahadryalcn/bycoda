import { t, useLocale } from "../../../shared/i18n";
import { Alert } from "../../../shared/ui/Alert";
import { NativeSelect } from "../../../shared/ui/Select";
import { TextField } from "../../../shared/ui/TextField";
import { Button } from "../../../shared/ui/Button";
import { useEffect, useRef, useState } from "react";
import { Notice } from "./socialShared";
import { REMOTE_PROVIDERS } from "../../connections/model/protocol";
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
}: {
  client: SocialClient;
  policies?: SocialPolicies;
  run: (action: () => Promise<unknown>) => Promise<boolean>;
}) {
  useLocale();
  const [scope, setScope] = useState<Scope>("global");
  const [drafts, setDrafts] = useState<Partial<Record<Scope, Draft>>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const savingRef = useRef(false);
  const version = JSON.stringify(policies);
  const value = scope === "global" ? policies.global : (policies.platforms[scope] ?? {});
  const draft = drafts[scope] ?? draftFor(value);
  const conflict = isEdited(draft) && policyKey(draft.base) !== policyKey(value);
  const effective = scope === "global" ? policies.global : effectiveSocialPolicy(policies, scope);

  // Refreshes may update other scopes during editing. Preserve edited drafts.
  useEffect(() => {
    setDrafts((current) => {
      const next = { ...current };
      let changed = false;
      for (const key of Object.keys(next) as Scope[]) {
        if (next[key] && !isEdited(next[key])) {
          delete next[key];
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [version]);

  const update = (changes: Partial<Omit<Draft, "base">>) => {
    setDrafts((current) => ({
      ...current,
      [scope]: { ...(current[scope] ?? draftFor(value)), ...changes },
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
      <p className="social-muted">
        {t(
          "Choose the agent and content limits. Platforms without settings use the shared settings.",
        )}
      </p>
      <label className="social-policy-scope">
        {t("Settings scope")}
        <NativeSelect
          value={scope}
          disabled={saving}
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
        {t("Active agent")}:{" "}
        {effective.agent
          ? `${HARNESS_TITLE[effective.agent.provider]} · ${effective.agent.model || t("default model")}`
          : t("AI off · verified fixed reply")}
        {scope !== "global" && !policies.platforms[scope]?.agent ? ` · ${t("shared setting")}` : ""}
      </p>
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
          void run(async () => {
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
          })
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
        <fieldset className="social-workspace" disabled={saving}>
          <label>
            {t("AI agent")}
            <NativeSelect
              value={draft.provider}
              onChange={(event) => update({ provider: event.target.value, model: "" })}
            >
              <option value="">
                {scope === "global" ? t("Do not use AI") : t("Use the shared agent setting")}
              </option>
              {REMOTE_PROVIDERS.map((id) => (
                <option key={id} value={id}>
                  {HARNESS_TITLE[id]}
                </option>
              ))}
            </NativeSelect>
          </label>
          <details className="social-settings">
            <summary>{t("Customize the model")}</summary>
            <TextField
              label={t("AI model")}
              value={draft.model}
              disabled={!draft.provider}
              maxLength={200}
              placeholder={t("Empty: the agent's default model")}
              onChange={(event) => update({ model: event.target.value })}
            />
          </details>
          <section className="social-policy-limits">
            <h3>{t("Character limits")}</h3>
            <div className="social-field-grid">
              {SOCIAL_LIMIT_FIELDS.map((field) => (
                <TextField
                  key={field}
                  label={labels[field]}
                  name={field}
                  type="number"
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
                      : t("No limit")
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
          </section>
          <div className="social-actions">
            <Button variant="primary" type="submit" disabled={conflict} loading={saving}>
              {saving ? t("Saving…") : t("Save settings")}
            </Button>
            {isEdited(draft) || conflict ? (
              <Button variant="secondary" type="button" onClick={reset}>
                {t("Load saved settings")}
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
