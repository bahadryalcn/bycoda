import { t } from "../../../../shared/i18n";
import { PlatformMark } from "../common/PlatformIcon";
import type { SocialAccount, SocialPolicies } from "../../model/social";
import { withUtm, type ContentDraft } from "./contentDraft";
import { characterCount, characterLimit, type Problem } from "./contentRules";

export type PlatformPreviewsProps = {
  accounts: SocialAccount[];
  draft: ContentDraft;
  policies?: SocialPolicies;
  problems: Problem[];
};

/** One card per selected account, side by side: its text, count against the limit and its problems. */
export function PlatformPreviews({ accounts, draft, policies, problems }: PlatformPreviewsProps) {
  if (!accounts.length) return null;
  const text = draft.text.trim();
  const link = withUtm(draft.link, draft.utm);
  return (
    <section className="content-previews" aria-label={t("Previews")}>
      {accounts.map((account) => {
        const reel = draft.platform[account.id]?.facebook?.target === "reel";
        const limit = characterLimit(account, policies, { reel, hasMedia: draft.media.length > 0 });
        const count = characterCount(account, text, link);
        const over = limit !== undefined && count > limit;
        const own = problems.filter((problem) => problem.accountId === account.id);
        return (
          <article key={account.id} className="content-preview" data-over={over || undefined}>
            <header className="content-preview-head">
              <PlatformMark platform={account.platform} size="sm" />
              <strong>{account.name}</strong>
            </header>
            <p className="content-preview-text">{text || t("Your post text appears here.")}</p>
            {draft.media.length ? (
              <p className="content-preview-note">
                {t("{p0} attachments", { p0: draft.media.length })}
              </p>
            ) : null}
            <p className="content-preview-count">
              {limit !== undefined
                ? t("{p0} of {p1} characters", { p0: count, p1: limit })
                : t("{p0} characters", { p0: count })}
            </p>
            {own.length ? (
              <ul className="content-preview-problems">
                {own.map((problem) => (
                  <li key={problem.text}>{problem.text}</li>
                ))}
              </ul>
            ) : null}
          </article>
        );
      })}
    </section>
  );
}
