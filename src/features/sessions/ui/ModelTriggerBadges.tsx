import type { CSSProperties } from "react";
import { useT } from "../../../shared/i18n";
import { Badge } from "../../../shared/ui/Badge";
import { Gauge, Zap } from "../../../shared/ui/icons";
import { surfaceAttributes } from "../../../shared/ui/Surface";

export type ModelTriggerBadgeData = {
  /** Colour dot plus label of the account the model runs on. */
  account?: { label: string; color?: string };
  /** Display label of the current effort level. */
  effort?: string;
  /** `on`/`off` for a model with Fast; absent when the model has no Fast, so no badge shows. */
  fast?: "on" | "off";
  /** Settings that differ from the model's default, e.g. a 1M context window. */
  extras?: { name: string; label: string }[];
};

/**
 * Setting badges of the field-style model trigger. Account and effort always stay; Fast and the
 * non-default extras are optional and drop out first when the field narrows. Every badge carries
 * its meaning in its accessible name.
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
            account.color ? (
              <span
                {...surfaceAttributes({ radius: "pill", variant: "user-color" }, "size-1.5")}
                style={{ "--surface-user-color": account.color } as CSSProperties}
                aria-hidden
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
      {fast ? (
        <Badge
          data-model-fast={fast}
          size="xs"
          appearance={fast === "on" ? "subtle" : "outline"}
          role="img"
          aria-label={fast === "on" ? t("Fast on") : t("Fast off")}
          className="shrink-0 @max-[22rem]/model-trigger:hidden"
          icon={
            <Zap
              className="icon-xs"
              fill={fast === "on" ? "currentColor" : "none"}
              strokeWidth={1.75}
              aria-hidden
            />
          }
        >
          {fast === "on" ? t("Fast") : t("Fast off")}
        </Badge>
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
