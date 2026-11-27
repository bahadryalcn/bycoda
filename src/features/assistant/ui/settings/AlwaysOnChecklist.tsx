import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatNumber, t } from "../../../../shared/i18n";
import type { AssistantAlwaysOn } from "../../../../shared/model/assistantAlwaysOn";
import type { AssistantModelPoolRow } from "../../../../shared/model/assistantModelPool";
import type { AssistantSnapshot } from "../../../../shared/model/host-contracts/assistant";
import { Badge, type BadgeTone } from "../../../../shared/ui/Badge";
import { Button } from "../../../../shared/ui/Button";
import { RefreshCw } from "../../../../shared/ui/icons";
import { Disclosure } from "../../../../shared/ui/Disclosure";
import { InfoTooltip } from "../../../../shared/ui/InfoPopover";
import { Row } from "../../../../shared/ui/settings";
import {
  deriveAlwaysOnItems,
  type AlwaysOnState,
  type AlwaysOnTarget,
  type AlwaysOnItem,
} from "../../model/assistantAlwaysOn";
import type { assistantRequest } from "../../model/assistantClient";

/** The badge tone and translated label of a checklist state; call it while rendering. */
function stateBadge(state: AlwaysOnState): { label: string; tone: BadgeTone } {
  switch (state) {
    case "done":
      return { label: t("Ready"), tone: "success" };
    case "todo":
      return { label: t("Not set"), tone: "warning" };
    case "unknown":
      return { label: t("Unknown"), tone: "neutral" };
    case "unsupported":
      return { label: t("Not supported"), tone: "neutral" };
    case "review":
      return { label: t("Review"), tone: "info" };
  }
}
/** The translated Settings location an item lives in. */
function whereLabel(target: AlwaysOnTarget): string {
  switch (target) {
    case "access":
      return t("Access");
    case "setup":
      return t("Quick setup");
    case "work":
    case "schedule":
      return t("Work");
  }
}

/**
 * "Ready for 24/7": reads the saved settings and shows what still stops the assistant working around
 * the clock. It only reads (`models.pool.get`, `alwaysOn.get`). Each item points at the existing
 * control that fixes it; `onOpen` opens that control, and without it the item names where it lives.
 */
export function AlwaysOnChecklist({
  request: owner,
  snapshot,
  onOpen,
}: {
  request: typeof assistantRequest;
  snapshot: AssistantSnapshot;
  onOpen?: (target: AlwaysOnTarget) => void;
}) {
  const [request] = useState(() => owner);
  const [poolRows, setPoolRows] = useState<AssistantModelPoolRow[] | null>(null);
  const [alwaysOn, setAlwaysOn] = useState<AssistantAlwaysOn | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const generation = useRef(0);
  const fetchLatest = useCallback(async () => {
    const mine = ++generation.current;
    const [pool, facts] = await Promise.allSettled([
      request({ op: "models.pool.get" }),
      request({ op: "alwaysOn.get" }),
    ]);
    if (mine !== generation.current) return;
    setPoolRows(pool.status === "fulfilled" ? (pool.value.modelPool?.rows ?? null) : null);
    setAlwaysOn(facts.status === "fulfilled" ? (facts.value.alwaysOn ?? null) : null);
    setLoading(false);
  }, [request]);
  const load = useCallback(() => {
    setLoading(true);
    return fetchLatest();
  }, [fetchLatest]);
  useEffect(() => {
    // The first fetch starts from the initial loading state, so it sets nothing synchronously.
    void fetchLatest();
    const owner = generation;
    return () => {
      owner.current++;
    };
  }, [fetchLatest]);
  const items = useMemo(
    () =>
      deriveAlwaysOnItems({
        profile: snapshot.profile,
        keepAwake: snapshot.keepAwake,
        poolRows,
        alwaysOn,
      }),
    [snapshot.profile, snapshot.keepAwake, poolRows, alwaysOn],
  );
  const row = (item: AlwaysOnItem) => (
    <Row
      key={item.id}
      label={item.label}
      descriptionVisible
      description={
        item.state !== "done"
          ? item.target && !onOpen
            ? `${item.detail} ${t("Settings · {p0}", { p0: whereLabel(item.target) })}`
            : item.detail
          : undefined
      }
      info={
        item.state === "done" && item.detail ? (
          <InfoTooltip label={item.label}>{item.detail}</InfoTooltip>
        ) : undefined
      }
    >
      <Badge tone={stateBadge(item.state).tone} size="xs">
        {stateBadge(item.state).label}
      </Badge>
      {item.target && onOpen && item.state !== "done" && (
        <Button type="button" size="sm" onClick={() => onOpen(item.target!)}>
          {item.target === "setup" ? t("Quick setup") : t("Open settings")}
        </Button>
      )}
    </Row>
  );
  const exceptions = items.filter((item) => item.state !== "done");
  return (
    <div data-always-on-checklist>
      <Row
        label={t("{p0} of {p1} checks ready", {
          p0: formatNumber(items.length - exceptions.length),
          p1: formatNumber(items.length),
        })}
      >
        <Button
          type="button"
          variant="ghost"
          size="sm"
          iconOnly
          label={t("Refresh")}
          startIcon={<RefreshCw className="icon-sm" />}
          loading={loading}
          onClick={() => void load()}
        />
      </Row>
      {!showAll && exceptions.map(row)}
      <Disclosure
        variant="row"
        size="sm"
        summary={t("All checks")}
        open={showAll}
        onOpenChange={setShowAll}
      >
        {items.map(row)}
      </Disclosure>
    </div>
  );
}
