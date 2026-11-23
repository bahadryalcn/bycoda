import { t, useLocale } from "../../../../shared/i18n";
import type { ModelRoutingResolution } from "../../../../shared/model/host-contracts/model-routing";
import { Badge } from "../../../../shared/ui/Badge";
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
 * is only claimed when the Host answered. A job that would wait shows just a "No model" badge;
 * the list explains it once.
 */
export function ModelRolePreview({ preview, helper }: { preview: RolePreview; helper: boolean }) {
  useLocale();
  const result = preview.data;
  if (waitsForModel(preview, helper))
    return (
      <Badge tone="warning" size="xs">
        {t("No model")}
      </Badge>
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
