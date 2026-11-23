import { useT } from "../../../shared/i18n";
import { Badge } from "../../../shared/ui/Badge";
import { Gauge, Zap } from "../../../shared/ui/icons";
import { ModelAccountNumber } from "./ModelAccountIdentity";

export type ModelTriggerBadgeData = {
  /** Number and label of the account the model runs on. */
  account?: { label: string; color?: string; number?: number };
  /** Display label of the current effort level. */
  effort?: string;
  /** `on`/`off` for a model with Fast; absent when the model has no Fast, so no badge shows. */
  fast?: "on" | "off";
  /** Settings that differ from the model's default, e.g. a 1M context window. */
  extras?: { name: string; label: string }[];
};

/**
 * Setting badges of the field-style model trigger. Account and effort always stay; Fast and the
 * non-default extras are optional and drop out first when the field narrows.
 */
export function ModelTriggerBadges({ account, effort, fast, extras = [] }: ModelTriggerBadgeData) {
  const t = useT();
  return (
    <>
      {account ? (
        <Badge
          data-model-account
          size="xs"
          appearance="subtle"
          truncate
          role="img"
          aria-label={t("Account: {p0}", { p0: account.label })}
          className="min-w-0 max-w-32"
          icon={
            account.number ? (
              <ModelAccountNumber
                account={{
                  accountNumber: account.number,
                  accountColor: account.color,
                }}
              />
            ) : undefined
          }
        >
          {account.label}
        </Badge>
      ) : null}
      {effort ? (
        <Badge
          data-model-effort
          size="xs"
          appearance="subtle"
          role="img"
          aria-label={t("Effort: {p0}", { p0: effort })}
          className="shrink-0"
          icon={<Gauge className="icon-xs" aria-hidden />}
        >
          {effort}
        </Badge>
      ) : null}
      {fast === "on" ? (
        <Badge
          data-model-fast={fast}
          size="xs"
          appearance="subtle"
          role="img"
          aria-label={t("Fast on")}
          className="shrink-0 @max-[22rem]/model-trigger:hidden"
          icon={<Zap className="icon-xs" fill="currentColor" strokeWidth={1.75} aria-hidden />}
        />
      ) : null}
      {extras.map((extra) => (
        <Badge
          key={extra.name}
          data-model-extra={extra.name}
          size="xs"
          appearance="subtle"
          truncate
          role="img"
          aria-label={t("{p0}: {p1}", { p0: extra.name, p1: extra.label })}
          className="min-w-0 max-w-24 @max-[30rem]/model-trigger:hidden"
        >
          {extra.label}
        </Badge>
      ))}
    </>
  );
}
