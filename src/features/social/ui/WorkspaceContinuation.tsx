import { CollectionFooter } from "../../../shared/ui/ContinuousList";
import { formatNumber, t, useLocale } from "../../../shared/i18n";
import type { SocialCollection, SocialSnapshot } from "../model/social";
import { SocialBusyContext as SocialLockContext } from "./socialContext";
import { useContext } from "react";
import type { Section } from "./useSocialWorkspaceController";

const sectionCollections: Record<Section, SocialCollection[]> = {
  accounts: [],
  campaigns: ["campaigns", "jobs"],
  inbox: ["threads", "drafts", "jobs"],
  audience: ["contacts", "threads", "drafts", "jobs"],
  plans: ["publishingPlans", "campaigns", "jobs"],
  rules: ["rules", "drafts", "jobs"],
  history: ["jobs"],
  sending: [],
  settings: [],
};

const collectionLabels = (): Record<SocialCollection, string> => ({
  campaigns: t("Campaigns"),
  publishingPlans: t("Sharing plans"),
  threads: t("Conversations"),
  contacts: t("Contacts"),
  rules: t("Reply rules"),
  jobs: t("Activity history"),
  drafts: t("Drafts"),
});

function loadedCount(snapshot: SocialSnapshot, collection: SocialCollection) {
  switch (collection) {
    case "campaigns":
      return snapshot.campaigns.length;
    case "publishingPlans":
      return snapshot.publishingPlans?.length ?? 0;
    case "threads":
      return snapshot.threads.length;
    case "contacts":
      return snapshot.contacts.length;
    case "rules":
      return snapshot.rules.length;
    case "jobs":
      return snapshot.jobs.length;
    case "drafts":
      return snapshot.drafts.length;
  }
}

export function WorkspaceContinuation({
  snapshot,
  section,
  disabled,
  onPage,
}: {
  snapshot: SocialSnapshot;
  section: Section;
  disabled: boolean;
  onPage: (collection: SocialCollection, offset: number) => void;
}) {
  const socialLocked = useContext(SocialLockContext);
  useLocale();
  const labels = collectionLabels();
  return (
    <nav aria-label={t("Load more")} className="social-filter-tabs">
      {sectionCollections[section]
        .filter((collection) => section !== "history" || collection !== "jobs")
        .map((collection) => {
          const page = snapshot.pages?.[collection];
          if (!page) return null;
          const hasMore = page.offset + page.limit < page.total;
          if (!hasMore && page.offset === 0) return null;
          return (
            <div
              key={collection}
              className="social-collection-continuation"
              aria-label={t("{p0} loaded", { p0: labels[collection] })}
            >
              <span>
                {labels[collection]} · {formatNumber(loadedCount(snapshot, collection))} /{" "}
                {formatNumber(page.total)}
              </span>
              <CollectionFooter
                loading={disabled}
                hasMore={hasMore && !socialLocked}
                onLoadMore={() =>
                  !socialLocked && !disabled && onPage(collection, page.offset + page.limit)
                }
              />
            </div>
          );
        })}
    </nav>
  );
}
