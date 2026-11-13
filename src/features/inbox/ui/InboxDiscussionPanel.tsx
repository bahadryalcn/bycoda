import { t } from "../../../shared/i18n";
import {
  SessionDiscussionPanel,
  type PanelSessionPortal,
} from "../../sessions/public/SessionDiscussionPanel";
import { inboxItemRef, type InboxItem } from "../model/githubTasks";
import { inboxAskKey } from "../model/inboxAsk";

export type InboxSessionPortal = PanelSessionPortal;

let rememberedWidth = 440;
const maxDiscussionWidth = () => Math.max(360, window.innerWidth - 650);

/** Inbox supplies context; the shared panel hosts the same real SessionPane used by Social. */
export function InboxDiscussionPanel({
  item,
  onClose,
  onOpen,
  onRestart,
  onMount,
}: {
  item: InboxItem;
  onClose: () => void;
  onOpen: (item: InboxItem) => Promise<string>;
  onRestart: (item: InboxItem) => Promise<string>;
  onMount: (portal: InboxSessionPortal | null) => void;
}) {
  return (
    <SessionDiscussionPanel
      className="inbox-discussion-panel"
      adaptiveBase
      scopeKey={inboxAskKey(item)}
      minWidth={360}
      maxWidth={maxDiscussionWidth}
      widthPreference={{
        initial: rememberedWidth,
        onCommit: (width) => {
          rememberedWidth = width;
        },
      }}
      title={
        <>
          {t("Ask · ")}
          {inboxItemRef(item)}
        </>
      }
      label={t("Ask about {p0}", { p0: inboxItemRef(item) })}
      onOpen={() => onOpen(item)}
      onRestart={() => onRestart(item)}
      onClose={onClose}
      onMount={onMount}
    />
  );
}
