import type { AssistantSnapshot } from "../../../../shared/model/host-contracts/assistant";
import { formatNumber, t } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";
import { Text } from "../../../../shared/ui/Text";
import { Select } from "../../../../shared/ui/Select";
import { Popover } from "../../../../shared/ui/Popover";
import { DescriptionItem, DescriptionList } from "../../../../shared/ui/DescriptionList";
import { InfoPopover } from "../../../../shared/ui/InfoPopover";
import { AssistantKeepAwakeStatus } from "../AssistantKeepAwakeStatus";
import { AssistantPresenceStatus } from "../AssistantPresenceStatus";
import styles from "./RoomShell.module.css";
import { date } from "./assistantRoomHelpers";
import { useAssistantRoom } from "./assistantRoomContext";

/** `workLabel` is the header chip's work state, so the panel names it instead of contradicting it. */
export function RoomStatusPopovers({
  snapshot,
  workLabel,
}: {
  snapshot: AssistantSnapshot;
  workLabel: string;
}) {
  const room = useAssistantRoom();
  const {
    setSettings,
    healthAnchor,
    setHealthAnchor,
    pending,
    mutate,
    returnToAssistant,
    roomPrivacy,
  } = room;

  return (
    <>
      {healthAnchor && (
        <Popover
          anchor={healthAnchor}
          onDismiss={() => setHealthAnchor(null)}
          kind="dialog"
          flow="scroll"
          aria-label={t("Assistant status")}
          variant="panel"
        >
          <Text as="div" size="caption" tone="inherit" leading="inherit" className={styles.popover}>
            <DescriptionList size="sm">
              <DescriptionItem
                term={
                  <>
                    {t("Work")}
                    <InfoPopover label={t("About work tracking")}>
                      <Text as="p" tone="muted" leading="inherit">
                        {t("Work tracking continues while voice is off.")}
                      </Text>
                    </InfoPopover>
                  </>
                }
              >
                {workLabel}
              </DescriptionItem>
              <DescriptionItem term={t("Presence")}>
                <AssistantPresenceStatus
                  snapshot={snapshot}
                  offline={Boolean(room.readError)}
                  details
                />
              </DescriptionItem>
              <DescriptionItem term={t("Last checked")}>
                {snapshot.lastHeartbeatAt
                  ? date(snapshot.lastHeartbeatAt)
                  : t("Waiting for the first check")}
              </DescriptionItem>
              <DescriptionItem term={t("Sleep prevention")}>
                <AssistantKeepAwakeStatus state={snapshot.keepAwake} />
              </DescriptionItem>
            </DescriptionList>
            {roomPrivacy.pending && (
              <Text as="p" tone="secondary" leading="normal">
                {t("Confirming Room privacy protection…")}
              </Text>
            )}
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
                mutate("presence", t("Updating…"), {
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
          </Text>
        </Popover>
      )}
    </>
  );
}
