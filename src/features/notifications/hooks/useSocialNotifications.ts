import { useEffect } from "react";
import { isLeadWindow } from "./useBackgroundNotifications";
import { notifySocialWaiting } from "../model/notifications";
import {
  loadAnnouncedSocial,
  rememberAnnouncedSocial,
  setSocialWaitingCount,
  socialWaitingVisibility,
} from "../model/socialWaiting";
import { readSocialWaiting, socialMachine } from "../model/socialWaitingFeed";

const POLL_MS = 60_000;

/** Unreadable polls in a row after which the last known count is dropped instead of shown. */
const MAX_UNREADABLE_POLLS = 3;

type PollState = { cancelled: boolean; running: boolean; unreadable: number };

/**
 * A Host that cannot be read keeps the last count for a few polls (a brief outage must not
 * flicker the badge), then the count is cleared: an old number from a Host that may be gone
 * is not shown as current. Nothing is announced either way.
 */
function noteUnreadable(state: PollState) {
  state.unreadable += 1;
  if (state.unreadable >= MAX_UNREADABLE_POLLS) setSocialWaitingCount(0);
}

async function pollSocial(state: PollState) {
  if (state.cancelled || state.running) return;
  state.running = true;
  try {
    if (!(await isLeadWindow())) {
      state.unreadable = 0;
      setSocialWaitingCount(0);
      return;
    }
    const machine = await socialMachine();
    if (state.cancelled) return;
    if (!machine) {
      // The authority Host was removed or unpaired: nothing there can wait for the owner.
      state.unreadable = 0;
      setSocialWaitingCount(0);
      return;
    }
    const items = await readSocialWaiting(machine);
    if (state.cancelled) return;
    if (!items) {
      noteUnreadable(state);
      return;
    }
    state.unreadable = 0;
    setSocialWaitingCount(
      items.filter((item) => socialWaitingVisibility(item, { indicator: true }) === "open").length,
    );
    const announced = loadAnnouncedSocial();
    const fresh = items.filter((item) => !announced.has(item.id));
    if (!fresh.length) return;
    // Remembered before delivery: an item is announced once, whatever the gates decide now.
    rememberAnnouncedSocial(fresh.map((item) => item.id));
    await notifySocialWaiting(fresh);
  } catch {
    // A Host that cannot be read is tried again next time and counts toward the staleness limit.
    if (!state.cancelled) noteUnreadable(state);
  } finally {
    state.running = false;
  }
}

/**
 * Watches the Social Host for items that wait for the owner (new project account requests,
 * browser tasks that need a person) whether or not the Social screen is open, announces each
 * one once and keeps the counter for the taskbar and Dock badge.
 */
export function useSocialNotifications() {
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Own the Social waiting-items polling timer and discard pending results after unmount.
  useEffect(() => {
    const state: PollState = { cancelled: false, running: false, unreadable: 0 };
    void pollSocial(state);
    const timer = setInterval(() => void pollSocial(state), POLL_MS);
    return () => {
      state.cancelled = true;
      clearInterval(timer);
    };
  }, []);
}
