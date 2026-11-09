import { useT } from "../i18n";
import { DescriptionItem, DescriptionList } from "./DescriptionList";
import { Disclosure } from "./Disclosure";
import { InlineTextAction } from "./ActionHost";

/** Disclosure and description-list specimens shown in the expanded control page. */
export function DisclosureSpecimen() {
  const t = useT();
  return (
    <div className="grid min-w-0 gap-3">
      <Disclosure summary={t("Details")}>
        <span>{t("Preview")}</span>
      </Disclosure>
      <Disclosure summary={t("Selected")} count={2} countLabel={t("Selected")} variant="row">
        <span>{t("Preview")}</span>
      </Disclosure>
      <Disclosure
        summary={t("Preview")}
        variant="card"
        summaryActions={<InlineTextAction onClick={() => undefined}>{t("Undo")}</InlineTextAction>}
      >
        <span>{t("Preview")}</span>
      </Disclosure>
      <DescriptionList columns="auto" size="sm">
        <DescriptionItem term={t("Name")}>{t("Preview")}</DescriptionItem>
        <DescriptionItem term={t("Layout")}>{t("Compact")}</DescriptionItem>
        <DescriptionItem term={t("Details")} monospace>
          sess_01HZX7F2K
        </DescriptionItem>
      </DescriptionList>
    </div>
  );
}
