import { t, useLocale } from "../../../../shared/i18n";
import type { ModelRoutingResolution } from "../../../../shared/model/host-contracts/model-routing";
import { InfoTooltip } from "../../../../shared/ui/InfoPopover";
import { TriangleAlert } from "../../../../shared/ui/icons";
import { Text } from "../../../../shared/ui/Text";
import { ModelLabel } from "../../../sessions/public/ModelLabel";

/** What the list reads for one job; the list owns the query so it can summarise all jobs once. */
export type RolePreview = { data?: ModelRoutingResolution; isError: boolean };

/** A job whose runs would wait: no entry is eligible and the job does not fall back by itself. */
export function waitsForModel(preview: RolePreview | undefined, helper: boolean): boolean {
  const data = preview?.data;
  return !helper && !preview?.isError && data?.ok === false && data.reason === "noEligibleEntry";
}

/**
 * One job's "which model now" line. Helpers fall back immediately when no entry is eligible; that
 * is only claimed when the Host answered. A job that would wait shows just a warning icon;
 * the list explains it once.
 */
export function ModelRolePreview({ preview, helper }: { preview: RolePreview; helper: boolean }) {
  useLocale();
  const result = preview.data;
  if (waitsForModel(preview, helper))
    return (
      <InfoTooltip
        label={t("No eligible model; this job will wait.")}
        icon={<TriangleAlert className="icon-sm" aria-hidden />}
      >
        {t("No eligible model; this job will wait.")}
      </InfoTooltip>
    );
  // A failed read is stated once by the list, and a pending read shows no line at all.
  if (preview.isError || !result) return null;
  return (
    <Text as="p" tone="secondary">
      {result.ok ? (
        <span className="inline-flex items-center gap-1">
          {t("Now uses")}
          <ModelLabel model={result.target.model} harness={result.target.harness} />
        </span>
      ) : helper ? (
        t("Automatic uses this helper's own model selection.")
      ) : (
        t("No model order configured. Uses the item's own model.")
      )}
    </Text>
  );
}
