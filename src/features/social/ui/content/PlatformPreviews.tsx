import { Text } from "../../../../shared/ui/Text";
import { t } from "../../../../shared/i18n";
import { Surface } from "../../../../shared/ui/Surface";
import { PlatformMark } from "../common/PlatformIcon";
import type { SocialAccount, SocialPolicies } from "../../model/social";
import { withUtm, xPostExtras, type ContentDraft } from "./contentDraft";
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
        const x = account.platform === "x" ? xPostExtras(draft.platform[account.id]?.x) : undefined;
        const linkedinFormat =
          account.platform === "linkedin" ? draft.platform[account.id]?.linkedinFormat : undefined;
        const limit = characterLimit(account, policies, { reel, hasMedia: draft.media.length > 0 });
        const count = characterCount(account, text, link);
        const over = limit !== undefined && count > limit;
        const own = problems.filter((problem) => problem.accountId === account.id);
        return (
          <Surface
            as="article"
            variant="card"
            padding="sm"
            key={account.id}
            className="content-preview"
            data-over={over || undefined}
          >
            <header className="content-preview-head">
              <PlatformMark platform={account.platform} size="sm" />
              <strong>{account.name}</strong>
            </header>
            <Text
              as="p"
              size="body"
              tone="inherit"
              leading="inherit"
              className="content-preview-text"
            >
              {text || (!linkedinFormat ? t("Your post text appears here.") : null)}
            </Text>
            {x?.quotePostId ? (
              <Text as="p" size="caption" tone="muted" className="content-preview-text">
                {t("Quote post ID")} {x.quotePostId}
              </Text>
            ) : null}
            {x?.communityId ? (
              <Text as="p" size="caption" tone="muted" className="content-preview-text">
                {t("Community ID")} {x.communityId}
              </Text>
            ) : null}
            {x?.poll ? (
              <>
                <Text as="p" size="caption" tone="muted" className="content-preview-text">
                  {t("Poll duration (minutes)")} {x.poll.durationMinutes}
                </Text>
                <Text as="p" size="body" className="content-preview-text">
                  {x.poll.options.join("\n")}
                </Text>
              </>
            ) : null}
            {x?.thread?.map((post, index) => (
              <div key={index}>
                <Text as="p" size="caption" tone="muted" className="content-preview-text">
                  {t("Thread post {p0}", { p0: index + 2 })}
                </Text>
                <Text as="p" size="body" className="content-preview-text">
                  {post}
                </Text>
              </div>
            ))}
            {linkedinFormat?.kind === "poll" ? (
              <Text as="p" size="secondary" leading="inherit" tone="inherit">
                {[linkedinFormat.question, ...linkedinFormat.options].filter(Boolean).join(" · ")}
              </Text>
            ) : null}
            {linkedinFormat?.kind === "article" ? (
              <Text as="p" size="secondary" leading="inherit" tone="inherit">
                {[linkedinFormat.title, linkedinFormat.source, linkedinFormat.description]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
            ) : null}
            {draft.media.length ? (
              <Text
                as="p"
                size="caption"
                tone="muted"
                leading="inherit"
                className="content-preview-note"
              >
                {t("{p0} attachments", { p0: draft.media.length })}
              </Text>
            ) : null}
            <Text
              as="p"
              size="caption"
              tone={over ? "danger" : "muted"}
              leading="inherit"
              className="content-preview-count"
            >
              {limit !== undefined
                ? t("{p0} of {p1} characters", { p0: count, p1: limit })
                : t("{p0} characters", { p0: count })}
            </Text>
            {own.length ? (
              <Text
                as="ul"
                size="caption"
                tone="danger"
                leading="inherit"
                className="content-preview-problems"
              >
                {own.map((problem) => (
                  <li key={problem.text}>{problem.text}</li>
                ))}
              </Text>
            ) : null}
          </Surface>
        );
      })}
    </section>
  );
}
