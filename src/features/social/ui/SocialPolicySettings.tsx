import { useEffect, useRef, useState } from "react";
import { Notice } from "./socialShared";
import { REMOTE_PROVIDERS } from "../../connections/model/protocol";
import { HARNESS_TITLE } from "../../sessions/model/session";
import {
  SOCIAL_PLATFORMS,
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
  maxContentCharacters: "Paylaşım karakter sınırı",
  maxCommentCharacters: "Yorum ve yanıt karakter sınırı",
  maxMessageCharacters: "Mesaj karakter sınırı",
};
const platforms = {
  x: "X",
  instagram: "Instagram",
  facebook: "Facebook",
  linkedin: "LinkedIn",
  youtube: "YouTube",
};
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
    setNotice("Kayıtlı ayarlar yüklendi.");
  };

  return (
    <section className="social-policy-panel" aria-label="Sosyal medya ajan ve içerik ayarları">
      <h2>AI ajanı ve içerik sınırları</h2>
      <p className="social-muted">
        Yanıtları hazırlayan ajanı ve içerik uzunluğunu belirleyin. Platforma özel alanları boş
        bırakırsanız ortak ayarlar kullanılır.
      </p>
      <label className="social-policy-scope">
        Ayar kapsamı
        <select
          value={scope}
          disabled={saving}
          onChange={(event) => {
            setScope(event.target.value as Scope);
            setError("");
            setNotice("");
          }}
        >
          <option value="global">Tüm platformlar</option>
          {SOCIAL_PLATFORMS.map((platform) => (
            <option key={platform} value={platform}>
              {platforms[platform]}
            </option>
          ))}
        </select>
      </label>
      <p className="social-policy-effective">
        Kayıtlı ajan:{" "}
        {effective.agent
          ? `${HARNESS_TITLE[effective.agent.provider]} · ${effective.agent.model || "varsayılan model"}`
          : "Ajan kullanılmıyor · doğrulanmış sabit yanıt"}
        {scope !== "global" && !policies.platforms[scope]?.agent ? " · ortak ayar" : ""}
      </p>
      {conflict ? (
        <p role="alert" className="social-error">
          Bu ayarlar başka bir oturumda güncellendi. Düzenlediğiniz değerler korunuyor. Devam etmek
          için kayıtlı ayarları yükleyin.
        </p>
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
                setError(`${labels[field]} 1 ile 20000 arasında tam sayı olmalı.`);
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
              "Ajanı ve model adını kontrol edin. Model adı en fazla 200 karakter olabilir.",
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
                `${savedScope === "global" ? "Ortak" : platforms[savedScope]} ayarlar kaydedildi.`,
              );
            } catch (error) {
              setError(`Ayarlar kaydedilemedi: ${errorText(error)}`);
              throw error;
            }
          })
            .then((success) => {
              if (!success && !started)
                setError("Başka bir işlem sürüyor. Kaydetmeyi tekrar deneyin.");
            })
            .catch((error) => setError(`Ayarlar kaydedilemedi: ${errorText(error)}`))
            .finally(() => {
              savingRef.current = false;
              setSaving(false);
            });
        }}
      >
        <fieldset className="social-workspace" disabled={saving}>
          <label>
            AI ajanı
            <select
              value={draft.provider}
              onChange={(event) => update({ provider: event.target.value, model: "" })}
            >
              <option value="">
                {scope === "global"
                  ? "Ajan kullanma · doğrulanmış sabit yanıt"
                  : "Ortak ajan ayarını kullan"}
              </option>
              {REMOTE_PROVIDERS.map((id) => (
                <option key={id} value={id}>
                  {HARNESS_TITLE[id]}
                </option>
              ))}
            </select>
          </label>
          <details className="social-settings">
            <summary>Model seçimi (isteğe bağlı)</summary>
            <label>
              AI modeli
              <input
                value={draft.model}
                disabled={!draft.provider}
                maxLength={200}
                placeholder="Boş: ajanın varsayılan modeli"
                onChange={(event) => update({ model: event.target.value })}
              />
            </label>
          </details>
          <div className="social-field-grid">
            {SOCIAL_LIMIT_FIELDS.map((field) => (
              <label key={field}>
                {labels[field]}
                <input
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
                      ? `Ortak sınır: ${policies.global[field]}`
                      : "Boş: ek sınır koyma"
                  }
                />
                <small>
                  Kayıtlı sınır: {effective[field] ?? "ek sınır yok"}
                  {scope !== "global" && policies.platforms[scope]?.[field] === undefined
                    ? " · ortak ayar"
                    : ""}
                </small>
              </label>
            ))}
          </div>
          <div className="social-actions">
            <button type="submit" className="social-primary" disabled={conflict}>
              {saving ? "Kaydediliyor…" : "Ayarları kaydet"}
            </button>
            {isEdited(draft) || conflict ? (
              <button type="button" onClick={reset}>
                Kayıtlı ayarları yükle
              </button>
            ) : null}
          </div>
        </fieldset>
        {error ? (
          <p className="social-error" role="alert">
            {error}
          </p>
        ) : null}
        {notice ? <Notice kind="success" title={notice} /> : null}
        <p className="social-muted">
          Platformun kendi sınırları ve gönderim onayı geçerliliğini korur. Ajan kullanılamadığında
          başka bir ajana otomatik geçilmez.
        </p>
      </form>
    </section>
  );
}
