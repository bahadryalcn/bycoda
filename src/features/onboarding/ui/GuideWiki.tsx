import { useState } from "react";
import { t } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { Heading } from "../../../shared/ui/Heading";
import { Link } from "../../../shared/ui/Link";
import { SearchInput } from "../../../shared/ui/SearchInput";
import { SectionLabel } from "../../../shared/ui/SectionLabel";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import wikiContent from "../model/wiki.json";

type Article = {
  id: string;
  title: string;
  summary: string;
  sections: {
    title: string;
    body: string[];
    steps?: string[];
    links?: { label: string; href: string }[];
  }[];
};

const wiki: { groups: { id: string; title: string; articles: Article[] }[] } = wikiContent;

function matches(article: Article, words: string[]) {
  const text = [
    article.title,
    article.summary,
    ...article.sections.flatMap((section) => [
      section.title,
      ...section.body,
      ...(section.steps ?? []),
    ]),
  ]
    .join(" ")
    .toLowerCase();
  return words.every((word) => text.includes(word));
}

export function GuideWiki({
  articleId,
  onSelectArticle,
}: {
  articleId: string;
  onSelectArticle: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const groups = wiki.groups.map((group) => ({
    ...group,
    articles: words.length
      ? group.articles.filter((article) => matches(article, words))
      : group.articles,
  }));
  const articles = groups.flatMap((group) => group.articles);
  const active = articles.find((article) => article.id === articleId) ?? articles[0];

  return (
    <>
      <div {...surfaceAttributes({ frame: "pane", edge: "block-end" }, "guide-hub-wiki-search")}>
        <SearchInput
          standalone
          appearance="field"
          type="search"
          aria-label={t("Search")}
          placeholder={t("Search")}
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
      </div>
      <nav
        {...surfaceAttributes({ frame: "pane", edge: "responsive-end" }, "guide-hub-nav")}
        aria-label={t("Guide topics")}
      >
        {groups
          .filter((group) => group.articles.length > 0)
          .map((group) => (
            <div key={group.id} className="guide-hub-group" lang="en">
              <SectionLabel as="h3" className="guide-hub-group-title">
                {group.title}
              </SectionLabel>
              {group.articles.map((article) => (
                <Button
                  key={article.id}
                  variant="item"
                  truncate
                  tooltipWhen="overflow"
                  aria-current={article.id === active?.id ? "page" : undefined}
                  selected={article.id === active?.id}
                  onClick={() => onSelectArticle(article.id)}
                >
                  {article.title}
                </Button>
              ))}
            </div>
          ))}
      </nav>
      {active ? (
        <article key={active.id} className="guide-hub-content" aria-labelledby="guide-wiki-title">
          <header className="guide-hub-wiki-section">
            <Heading size="page" level={2} id="guide-wiki-title" lang="en">
              {active.title}
            </Heading>
            <Link href={`https://bycoda.codes/guide/${active.id}`}>{t("Open in browser")}</Link>
          </header>
          {active.sections.map((section) => (
            <section className="guide-hub-wiki-section" key={section.title} lang="en">
              <Heading size="section" level={3}>
                {section.title}
              </Heading>
              {section.body.map((paragraph) => (
                <Text as="p" size="body" tone="primary" key={paragraph}>
                  {paragraph}
                </Text>
              ))}
              {section.steps?.length ? (
                <ol className="guide-hub-wiki-list">
                  {section.steps.map((step) => (
                    <li key={step}>
                      <Text size="body">{step}</Text>
                    </li>
                  ))}
                </ol>
              ) : null}
              {section.links?.length ? (
                <ul className="guide-hub-wiki-list">
                  {section.links.map((link) => (
                    <li key={link.href}>
                      <Link href={link.href}>{link.label}</Link>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ))}
        </article>
      ) : (
        <div className="guide-hub-content">
          <EmptyState
            context="panel"
            kind="filtered"
            title={t("No results")}
            description={t("Try a different search or clear the filters.")}
            onReset={() => setQuery("")}
            resetLabel={t("Clear search")}
          />
        </div>
      )}
    </>
  );
}
