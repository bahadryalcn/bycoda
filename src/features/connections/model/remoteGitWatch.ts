import { setRemoteGitWatcher } from "../../../platform/tauri/fs";
import { cachedRemoteCapabilities, loadRemoteCapabilities, remoteMachineFor } from "./connections";
import { subscribeRemoteRecovered } from "./remoteHealth";
import { subscribeRemoteMachineChannel } from "./remoteMachineChannel";
import { parseRemotePath } from "./remoteProjects";

/** The host watches the checkout's `.git` itself (host/git/git-watch.ts). */
export const GIT_WATCH = "git.watch";
/** A checkout the host cannot watch is not asked about for this long, so an
 * unwatchable folder cannot wake the machine lane on every request. */
export const GIT_UNWATCHABLE_RETRY_MS = 60_000;
/** Waits between attempts after a capability or machine lookup failed while the
 * machine stayed connected; once spent, only a recovery asks again. */
export const GIT_START_RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 30_000];

/** Reports `.git` changes of a checkout on a connected machine, over that
 * machine's shared change lane. Never marks the checkout watched unless the
 * host advertises `git.watch` and answers that it watches this checkout. */
export function watchRemoteGit(
  cwd: string,
  report: (index: boolean, refs: boolean) => void,
  setWatching: (on: boolean) => void,
): () => void {
  const remote = parseRemotePath(cwd);
  if (!remote) return () => {};
  const { environmentId, hostPath } = remote;
  let disposed = false;
  let stopChannel: (() => void) | undefined;
  let stopRecovered: (() => void) | undefined;
  let known = "";
  let watching = false;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let failures = 0;

  const apply = (on: boolean) => {
    if (watching === on) return;
    watching = on;
    setWatching(on);
  };

  // A lookup that failed or came back empty is retried a few times with growing
  // waits; a host that answered without `git.watch` is not asked again.
  const retryStart = () => {
    if (disposed || stopChannel || retry !== undefined) return;
    const delay = GIT_START_RETRY_DELAYS_MS[failures];
    if (delay === undefined) return;
    failures += 1;
    retry = setTimeout(() => {
      retry = undefined;
      begin();
    }, delay);
  };

  const begin = () => {
    start().catch(retryStart);
  };

  const start = async () => {
    if (disposed || stopChannel || retry !== undefined) return;
    let capabilities = cachedRemoteCapabilities(environmentId);
    if (!capabilities)
      capabilities = await loadRemoteCapabilities(environmentId).catch(() => undefined);
    if (disposed || stopChannel) return;
    if (!capabilities) return retryStart();
    if (!capabilities.includes(GIT_WATCH)) return;
    const machine = await remoteMachineFor(environmentId);
    if (disposed || stopChannel) return;
    if (!machine) return retryStart();
    failures = 0;
    stopChannel = subscribeRemoteMachineChannel(
      machine.id,
      () => ({ git: [{ cwd: hostPath, ...(known ? { known } : {}) }] }),
      (changes) => {
        // The first poll of a lane reports a reset: there is nothing to refresh yet.
        if (changes.reset && known) {
          known = "";
          report(true, true);
        }
        const entry = changes.git?.find((candidate) => candidate.cwd === hostPath);
        if (!entry) return;
        if (!entry.watching) {
          // Old triggers take over; ask again later, from a fresh baseline.
          known = "";
          apply(false);
          // Leave the lane (an empty demand would spin it) until the retry.
          queueMicrotask(() => {
            stopChannel?.();
            stopChannel = undefined;
            if (!disposed && retry === undefined)
              retry = setTimeout(() => {
                retry = undefined;
                begin();
              }, GIT_UNWATCHABLE_RETRY_MS);
          });
          return;
        }
        const previous = known;
        known = entry.etag;
        apply(true);
        // An answer to a merged request without our cursor cannot say what changed.
        if (previous && entry.etag !== previous) {
          const unknown = !entry.index && !entry.refs;
          report(entry.index || unknown, entry.refs || unknown);
        }
      },
    );
  };

  begin();
  // A machine that was not reachable yet gets another look once it recovers,
  // with a fresh retry budget and without waiting out a pending retry.
  stopRecovered = subscribeRemoteRecovered(() => {
    failures = 0;
    clearTimeout(retry);
    retry = undefined;
    begin();
  });

  return () => {
    disposed = true;
    clearTimeout(retry);
    stopRecovered?.();
    stopChannel?.();
    stopChannel = undefined;
  };
}

setRemoteGitWatcher(watchRemoteGit);
