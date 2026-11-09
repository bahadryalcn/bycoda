import { formatNumber, getLocale, useT } from "../../../shared/i18n";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";
import { Disclosure } from "../../../shared/ui/Disclosure";
import { Progress } from "../../../shared/ui/Progress";
import { candidateKey } from "../import/importModel";
import type { ImportProgress, ImportSummary } from "../import/importRunner";

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${formatNumber(count)} ${count === 1 ? one : many}`;
}

export function RunningView({ progress }: { progress: ImportProgress }) {
  const t = useT();
  const percent = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  return (
    <div className="flex flex-col gap-3 py-6" role="status">
      <p className="text-ui-secondary font-medium">
        {t("Importing ")}
        {progress.done.toLocaleString(getLocale())}
        {t(" of")} {progress.total.toLocaleString(getLocale())}…
      </p>
      <Progress compact value={percent} max={100} />
      <p className="truncate text-ui-caption text-(--ui-text-secondary)">
        {progress.current ?? " "}
      </p>
      <p className="text-ui-micro text-(--ui-text-secondary)">
        {progress.imported.toLocaleString(getLocale())}
        {t(" imported")}
        {progress.skipped > 0 ? t(" · {p0} skipped", { p0: progress.skipped }) : ""}
        {progress.failed.length > 0 ? t(" · {p0} failed", { p0: progress.failed.length }) : ""}
      </p>
    </div>
  );
}

export function DoneView({ summary }: { summary: ImportSummary }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-3 py-4">
      <p className="text-ui-body font-medium">
        {summary.cancelled ? t("Import cancelled") : t("Import finished")}
      </p>
      <ul className="flex flex-col gap-1 text-ui-caption text-(--ui-text-secondary)">
        <li>
          {plural(summary.imported, "conversation")}
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
            {plural(summary.projects, "folder")}
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
      </ul>
      {summary.failed.length > 0 ? (
        <Disclosure
          size="sm"
          variant="card"
          className="border-(--ui-tone-danger-border) bg-(--ui-tone-danger-subtle)"
          summary={
            <span className="text-(--ui-tone-danger-fg)">
              {plural(summary.failed.length, "conversation")}
              {t(" could not be imported")}
            </span>
          }
        >
          <ul className="mt-2 flex max-h-40 flex-col gap-1 overflow-y-auto">
            {summary.failed.map((failure) => (
              <li key={candidateKey(failure.candidate)} className="text-(--ui-text-secondary)">
                <span className="text-(--ui-tone-neutral-fg)">{failure.candidate.firstPrompt}</span>
                {" — "}
                {failure.error}
              </li>
            ))}
          </ul>
        </Disclosure>
      ) : null}
    </div>
  );
}
