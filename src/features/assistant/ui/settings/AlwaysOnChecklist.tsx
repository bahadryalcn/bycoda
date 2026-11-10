import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { t } from "../../../../shared/i18n";
import type { AssistantAlwaysOn } from "../../../../shared/model/assistantAlwaysOn";
import type { AssistantModelPoolRow } from "../../../../shared/model/assistantModelPool";
import type { AssistantSnapshot } from "../../../../shared/model/host-contracts/assistant";
import { Badge, type BadgeTone } from "../../../../shared/ui/Badge";
import { Button } from "../../../../shared/ui/Button";
import { RefreshCw } from "../../../../shared/ui/icons";
import { Row } from "../../../settings/public/settingsControls";
import {
  deriveAlwaysOnItems,
  type AlwaysOnState,
  type AlwaysOnTarget,
} from "../../model/assistantAlwaysOn";
import type { assistantRequest } from "../../model/assistantClient";

const STATE: Record<AlwaysOnState, { label: string; tone: BadgeTone }> = {
  done: { label: "Ready", tone: "success" },
  todo: { label: "Not set", tone: "warning" },
  unknown: { label: "Unknown", tone: "neutral" },
  unsupported: { label: "Not supported", tone: "neutral" },
  review: { label: "Review", tone: "info" },
};
const WHERE: Record<AlwaysOnTarget, string> = {
  setup: "Quick setup",
  work: "Work",
  schedule: "Work",
};

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
  return (
    <div data-always-on-checklist>
      {items.map((item) => (
        <Row
          key={item.id}
          label={item.label}
          description={
            item.target && !onOpen && item.state !== "done"
              ? `${item.detail} ${t("Settings · {p0}", { p0: t(WHERE[item.target]) })}`
              : item.detail || undefined
          }
        >
          <Badge tone={STATE[item.state].tone} size="xs">
            {t(STATE[item.state].label)}
          </Badge>
          {item.target && onOpen && item.state !== "done" && (
            <Button type="button" size="sm" onClick={() => onOpen(item.target!)}>
              {t(item.target === "setup" ? "Quick setup" : "Open settings")}
            </Button>
          )}
        </Row>
      ))}
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
    </div>
  );
}
