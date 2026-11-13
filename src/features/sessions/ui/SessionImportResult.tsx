import { Text } from "../../../shared/ui/Text";
import { useFormat, useLocale, useT } from "../../../shared/i18n";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";
import { Surface } from "../../../shared/ui/Surface";
import { Progress } from "../../../shared/ui/Progress";
import { candidateKey } from "../import/importModel";
import type { ImportProgress, ImportSummary } from "../import/importRunner";

export function plural(
  formatNumber: (count: number) => string,
  count: number,
  one: string,
  many = `${one}s`,
): string {
  return `${formatNumber(count)} ${count === 1 ? one : many}`;
}

export function RunningView({ progress }: { progress: ImportProgress }) {
  const t = useT();
  const locale = useLocale();
  const percent = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  return (
    <div className="flex flex-col gap-3 py-6" role="status">
      <Text as="p" size="secondary" tone="inherit" weight="medium">
        {t("Importing ")}
        {progress.done.toLocaleString(locale)}
        {t(" of")} {progress.total.toLocaleString(locale)}…
      </Text>
      <Progress compact value={percent} max={100} />
      <Text as="p" size="caption" tone="secondary" truncate>
        {progress.current ?? " "}
      </Text>
      <Text as="p" size="micro" tone="secondary">
        {progress.imported.toLocaleString(locale)}
        {t(" imported")}
        {progress.skipped > 0 ? t(" · {p0} skipped", { p0: progress.skipped }) : ""}
        {progress.failed.length > 0 ? t(" · {p0} failed", { p0: progress.failed.length }) : ""}
      </Text>
    </div>
  );
}

export function DoneView({ summary }: { summary: ImportSummary }) {
  const t = useT();
  const { formatNumber } = useFormat();
  return (
    <div className="flex flex-col gap-3 py-4">
      <Text as="p" size="body" tone="inherit" weight="medium">
        {summary.cancelled ? t("Import cancelled") : t("Import finished")}
      </Text>
      <Text as="ul" className="flex flex-col gap-1">
        <li>
          {plural(formatNumber, summary.imported, "conversation")}
          {t(" imported.")}
        </li>
        {summary.skipped > 0 ? (
          <li>
            {summary.skipped}
            {t(" already in ")}
            {PRODUCT_IDENTITY.displayName}
            {t(", skipped.")}
          </li>
        ) : null}
        {summary.projects > 0 ? (
          <li>
            {plural(formatNumber, summary.projects, "folder")}
            {t(" added to the sidebar")}
            {summary.groups.length > 0
              ? t(", grouped as {p0}", { p0: summary.groups.join(", ") })
              : ""}
            .
          </li>
        ) : null}
        {summary.readOnly > 0 ? (
          <li>
            {summary.readOnly}
            {t(
              " can only be read: their folder is gone or could not be matched, so a new message starts a new conversation.",
            )}
          </li>
        ) : null}
        {summary.truncated > 0 ? (
          <li>
            {summary.truncated}
            {t(" were large, so only their most recent part was imported.")}
          </li>
        ) : null}
      </Text>
      {summary.failed.length > 0 ? (
        <Surface variant="card" frame="danger" tone="danger" padding="sm">
          <Text as="p" size="inherit" tone="danger">
            {plural(formatNumber, summary.failed.length, "conversation")}
            {t(" could not be imported")}
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
