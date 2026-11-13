import { useSyncExternalStore } from "react";
import { Alert } from "../../../shared/ui/Alert";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { useT } from "../../../shared/i18n";
import { sameProjectPath } from "../../projects/public/recents";
import {
  dismissRemoteActivityNotice,
  getRemoteActivityNotices,
  subscribeRemoteActivityNotices,
  type RemoteActivityNotice,
} from "../model/remoteActivityNotice";

/** What another device did in this project (`cwd`) or in the inbox (`inbox`). */
export function RemoteActivityNotices(props: { cwd: string } | { inbox: true }) {
  const notices = useSyncExternalStore(
    subscribeRemoteActivityNotices,
    getRemoteActivityNotices,
    getRemoteActivityNotices,
  );
  return notices
    .filter((notice) =>
      "inbox" in props
        ? notice.scope === "inbox"
        : notice.scope !== "inbox" && sameProjectPath(notice.scope.cwd, props.cwd),
    )
    .map((notice) => (
      <RemoteActivity
        key={`${notice.kind}:${notice.scope === "inbox" ? "inbox" : notice.scope.cwd}`}
        notice={notice}
      />
    ));
}

function RemoteActivity({ notice }: { notice: RemoteActivityNotice }) {
  const t = useT();
  const device = notice.devices.join(", ") || t("Another device");
  const one = notice.done === 1;
  const n = notice.done;
  const messages: Record<RemoteActivityNotice["kind"], string> = {
    deleted: one
      ? t("{p0} deleted 1 conversation.", { p0: device })
      : t("{p0} deleted {p1} conversations.", { p0: device, p1: n }),
    archived: one
      ? t("{p0} archived 1 conversation.", { p0: device })
      : t("{p0} archived {p1} conversations.", { p0: device, p1: n }),
    stopped: one
      ? t("{p0} stopped 1 conversation.", { p0: device })
      : t("{p0} stopped {p1} conversations.", { p0: device, p1: n }),
    takenOver: one
      ? t("Another computer took over 1 conversation, so it stopped here.")
      : t("Another computer took over {p0} conversations, so they stopped here.", { p0: n }),
    approved: one
      ? t("{p0} answered 1 approval request.", { p0: device })
      : t("{p0} answered {p1} approval requests.", { p0: device, p1: n }),
    answered: one
      ? t("{p0} answered 1 question.", { p0: device })
      : t("{p0} answered {p1} questions.", { p0: device, p1: n }),
    inbox: one
      ? t("{p0} made 1 change through this computer's inbox accounts.", { p0: device })
      : t("{p0} made {p1} changes through this computer's inbox accounts.", {
          p0: device,
          p1: n,
        }),
    worktreeChanged: one
      ? t("{p0} changed 1 worktree in this project.", { p0: device })
      : t("{p0} changed {p1} worktrees in this project.", { p0: device, p1: n }),
    settingsChanged: t("{p0} changed this project's workspace settings.", { p0: device }),
  };
  const actions: Record<RemoteActivityNotice["kind"], string> = {
    deleted: t("Delete conversations"),
    archived: t("Archive conversations"),
    stopped: t("Stop conversations"),
    takenOver: t("Take over conversations"),
    approved: t("Answer approval requests"),
    answered: t("Answer questions"),
    inbox: t("Inbox changes"),
    worktreeChanged: t("Worktree changes"),
    settingsChanged: t("Workspace settings changes"),
  };
  const failure = t("{p0} could not be completed.", { p0: notice.failed });
  const text = [
    notice.done > 0 ? messages[notice.kind] : "",
    notice.failed > 0
      ? notice.done > 0
        ? failure
        : `${device} · ${actions[notice.kind]}: ${failure}`
      : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div
      {...surfaceAttributes({ frame: "stroke", edge: "bottom" }, "shrink-0 px-3 py-2")}
      data-remote-activity={notice.kind}
    >
      <Alert
        inline
        tone={notice.failed ? "warning" : "info"}
        onDismiss={() => dismissRemoteActivityNotice(notice)}
      >
        <span className="min-w-0 break-words">{text}</span>
      </Alert>
    </div>
  );
}
