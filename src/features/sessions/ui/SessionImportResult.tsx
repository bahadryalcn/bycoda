import { Text } from "../../../shared/ui/Text";
import { useFormat, useT } from "../../../shared/i18n";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";
import { Surface } from "../../../shared/ui/Surface";
import { Progress } from "../../../shared/ui/Progress";
import { candidateKey } from "../import/importModel";
import type { ImportProgress, ImportSummary } from "../import/importRunner";

/** Complete count labels: translators own number placement and noun forms. */
export function importCount(
  t: (message: string, values?: Record<string, unknown>) => string,
  count: number,
  noun: "conversation" | "folder" | "group",
): string {
  switch (noun) {
    case "conversation":
      return count === 1
        ? t("{p0} conversation", { p0: count })
        : t("{p0} conversations", { p0: count });
    case "folder":
      return count === 1 ? t("{p0} folder", { p0: count }) : t("{p0} folders", { p0: count });
    case "group":
      return count === 1 ? t("{p0} group", { p0: count }) : t("{p0} groups", { p0: count });
  }
}

export function RunningView({ progress }: { progress: ImportProgress }) {
  const t = useT();
  const { formatNumber } = useFormat();
  const percent = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  return (
    <div className="flex flex-col gap-3 py-6" role="status">
      <Text as="p" size="secondary" tone="inherit" weight="medium">
        {t("Importing {p0} of {p1}…", {
          p0: formatNumber(progress.done),
          p1: formatNumber(progress.total),
        })}
      </Text>
      <Progress compact value={percent} max={100} />
      <Text as="p" size="caption" tone="secondary" truncate>
        {progress.current ?? " "}
      </Text>
      <Text as="p" size="micro" tone="secondary">
        {t("Imported: {p0}", { p0: formatNumber(progress.imported) })}
        {progress.skipped > 0 ? t(" · {p0} skipped", { p0: progress.skipped }) : ""}
        {progress.failed.length > 0 ? t(" · {p0} failed", { p0: progress.failed.length }) : ""}
      </Text>
    </div>
  );
}

export function DoneView({ summary }: { summary: ImportSummary }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-3 py-4">
      <Text as="p" size="body" tone="inherit" weight="medium">
        {summary.cancelled ? t("Import cancelled") : t("Import finished")}
      </Text>
      <Text as="ul" className="flex flex-col gap-1">
        <li>{t("Imported conversations: {p0}.", { p0: summary.imported })}</li>
        {summary.skipped > 0 ? (
          <li>
            {t("Skipped {p0} conversations already in {p1}.", {
              p0: summary.skipped,
              p1: PRODUCT_IDENTITY.displayName,
            })}
          </li>
        ) : null}
        {summary.projects > 0 ? (
          <li>
            {t("Folders added to the sidebar: {p0}", { p0: summary.projects })}
            {summary.groups.length > 0
              ? t(", grouped as {p0}", { p0: summary.groups.join(", ") })
              : ""}
            .
          </li>
        ) : null}
        {summary.readOnly > 0 ? (
          <li>
            {t(
              "Read-only conversations: {p0}. Their folder is gone or could not be matched, so a new message starts a new conversation.",
              { p0: summary.readOnly },
            )}
          </li>
        ) : null}
        {summary.truncated > 0 ? (
          <li>
            {t("Large conversations: {p0}. Only their most recent part was imported.", {
              p0: summary.truncated,
            })}
          </li>
        ) : null}
      </Text>
      {summary.failed.length > 0 ? (
        <Surface variant="card" frame="danger" tone="danger" padding="sm">
          <Text as="p" size="inherit" tone="danger">
            {t("Conversations that could not be imported: {p0}", { p0: summary.failed.length })}
          </Text>
          <ul className="mt-2 flex max-h-40 flex-col gap-1 overflow-y-auto">
            {summary.failed.map((failure) => (
              <Text key={candidateKey(failure.candidate)} as="li" size="inherit" tone="secondary">
                <Text size="inherit" tone="neutral">
                  {failure.candidate.firstPrompt}
                </Text>
                {" — "}
                {failure.error}
              </Text>
            ))}
          </ul>
        </Surface>
      ) : null}
    </div>
  );
}
