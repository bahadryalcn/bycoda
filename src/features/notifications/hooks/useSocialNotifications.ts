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

type PollState = { cancelled: boolean; running: boolean };

async function pollSocial(state: PollState) {
  if (state.cancelled || state.running) return;
  state.running = true;
  try {
    if (!(await isLeadWindow())) {
      setSocialWaitingCount(0);
      return;
    }
    const machine = await socialMachine();
    const items = machine ? await readSocialWaiting(machine) : undefined;
    // An unreadable Host keeps the last count and announces nothing.
    if (state.cancelled || !items) return;
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
    // A Host that cannot be read is tried again next time.
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
    const state: PollState = { cancelled: false, running: false };
    void pollSocial(state);
    const timer = setInterval(() => void pollSocial(state), POLL_MS);
    return () => {
      state.cancelled = true;
      clearInterval(timer);
    };
  }, []);
}
