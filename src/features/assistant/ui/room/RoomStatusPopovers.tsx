import type { AssistantSnapshot } from "../../../../shared/model/host-contracts/assistant";
import { formatNumber, t } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";
import { Select } from "../../../../shared/ui/Select";
import { Popover } from "../../../../shared/ui/Popover";
import { AssistantKeepAwakeStatus } from "../AssistantKeepAwakeStatus";
import { AssistantPresenceStatus } from "../AssistantPresenceStatus";
import styles from "./RoomShell.module.css";
import { date } from "./assistantRoomHelpers";
import { useAssistantRoom } from "./assistantRoomContext";

export function RoomStatusPopovers({ snapshot }: { snapshot: AssistantSnapshot }) {
  const room = useAssistantRoom();
  const {
    setSettings,
    healthAnchor,
    setHealthAnchor,
    presenceAnchor,
    setPresenceAnchor,
    pending,
    mutate,
    returnToAssistant,
  } = room;

  return (
    <>
      {healthAnchor && (
        <Popover
          anchor={healthAnchor}
          onDismiss={() => setHealthAnchor(null)}
          kind="dialog"
          aria-label={t("Assistant status")}
        >
          <div className={styles.popover}>
            <AssistantPresenceStatus snapshot={snapshot} details />
            <p>
              {snapshot.lastHeartbeatAt
                ? t("Last checked: {p0}", {
                    p0: date(snapshot.lastHeartbeatAt),
                  })
                : t("Waiting for the first check")}
            </p>
            <AssistantKeepAwakeStatus state={snapshot.keepAwake} />
            <Button
              variant="link"
              onClick={() => {
                setHealthAnchor(null);
                setSettings(true);
              }}
            >
              {t(snapshot.usage.estimated ? "About {p0} tokens today" : "{p0} tokens today", {
                p0: formatNumber(snapshot.usage.total),
              })}
            </Button>
            <p>{t("Work tracking continues while voice is off.")}</p>
          </div>
        </Popover>
      )}
      {presenceAnchor && (
        <Popover
          anchor={presenceAnchor}
          onDismiss={() => setPresenceAnchor(null)}
          kind="dialog"
          aria-label={t("Presence")}
        >
          <div className={styles.popover}>
            <Select
              hideLabel
              label={t("Presence")}
              value={snapshot.presence.state}
              options={[
                ["present", "I'm here"],
                ["away", "Away"],
                ["dnd", "Do not disturb"],
                ["idle", "Idle"],
              ].map(([value, label]) => ({ value, label: t(label) }))}
              disabled={Boolean(pending)}
              onValueChange={(state) =>
                mutate("presence", t("Updating..."), {
                  op: "presence.set",
                  state: state as "present" | "away" | "dnd" | "idle",
                })
              }
            />
            <Button
              disabled={Boolean(pending)}
              loading={pending?.key === "presence.return"}
              onClick={returnToAssistant}
            >
              {t("I'm back")}
            </Button>
          </div>
        </Popover>
      )}
    </>
  );
}
