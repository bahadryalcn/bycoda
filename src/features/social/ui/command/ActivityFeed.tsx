import { t } from "../../../../shared/i18n";
import { formatRelativeTime } from "../../../../shared/i18n/format";
import { SectionLabel } from "../../../../shared/ui/SectionLabel";
import type { AiAction } from "../../model/autonomy";
import { ActivityRow } from "../common/ActivityRow";
import { EmptyHint } from "../common/EmptyHint";
import { TechnicalDetails } from "../common/TechnicalDetails";
import {
  activityKind,
  activityStatus,
  activityTitle,
  groupActivityByDay,
  undoBlockedReason,
} from "./commandModel";

export type ActivityFeedProps = {
  /** undefined until the Host answered; the screen shows the read error instead. */
  items: AiAction[] | undefined;
  onUndo: (actionId: string) => void;
};

/**
 * Live AI activity as a timeline, newest first, grouped by day. Undo appears only where the Host
 * can run it; when it cannot, the reason is written under Details.
 */
export function ActivityFeed({ items, onUndo }: ActivityFeedProps) {
  if (!items) return null;
  if (!items.length)
    return (
      <EmptyHint message={t("Nothing has happened yet. Ask AI for something above to start.")} />
    );
  return (
    <section className="command-activity" aria-label={t("Activity")}>
      {groupActivityByDay(items).map((group) => (
        <div key={group.key} className="command-activity-group">
          <SectionLabel as="h4" classNames={{ label: "command-day-label" }}>
            {group.label}
          </SectionLabel>
          <div className="activity-timeline">
            {group.items.map((item) => {
              const undoReason = undoBlockedReason(item);
              return (
                <ActivityRow
                  key={item.id}
                  title={activityTitle(item)}
                  kind={activityKind(item)}
                  time={formatRelativeTime(item.at)}
                  status={activityStatus(item)}
                  details={
                    <>
                      {item.reason ? (
                        <p className="command-activity-reason">{item.reason}</p>
                      ) : null}
                      {undoReason ? <p className="command-activity-reason">{undoReason}</p> : null}
                      <TechnicalDetails>
                        <code>{item.id}</code>
                      </TechnicalDetails>
                    </>
                  }
                  undo={undoReason ? undefined : { onUndo: () => onUndo(item.id) }}
                />
              );
            })}
          </div>
        </div>
      ))}
    </section>
  );
}
