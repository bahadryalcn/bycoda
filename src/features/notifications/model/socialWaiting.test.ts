// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import type { SocialAccountRequest } from "../../social/model/accountRequests";
import type { NeedsHumanItem } from "../../social/model/socialActions";
import { saveNotificationEvent } from "./notificationEvents";
import { readNotificationHistory } from "./notificationHistory";
import { updateNotificationPreferences } from "./notificationPreferences";
import {
  BACKGROUND_NOTIFICATION_TARGETS,
  notifySocialWaiting,
  saveNotificationsEnabled,
  setWindowFocused,
} from "./notifications";
import {
  buildSocialWaiting,
  loadAnnouncedSocial,
  rememberAnnouncedSocial,
  setSocialWaitingCount,
  socialWaitingCount,
  socialWaitingVisibility,
  subscribeSocialWaiting,
  type SocialWaitingItem,
} from "./socialWaiting";

const { invoke, locked } = vi.hoisted(() => ({ invoke: vi.fn(), locked: new Set<string>() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("../../group-lock/model/groupLock", () => ({
  isProjectLocked: (path: string) => locked.has(path),
  subscribeGroupLock: () => () => undefined,
}));

const banners = () => invoke.mock.calls.filter(([command]) => command === "show_notification");
const logged = async (count: number) => {
  await vi.waitFor(() => expect(readNotificationHistory().length).toBeGreaterThanOrEqual(count));
  return readNotificationHistory();
};

const request = (patch: Partial<SocialAccountRequest> = {}): SocialAccountRequest => ({
  id: "r1",
  projectId: "p1",
  platform: "x",
  accountType: "member",
  reason: "Private campaign wording",
  requestedBy: { provider: "claude", actorId: "a" },
  status: "pending",
  createdAt: 1_800_000_000_000,
  updatedAt: 1_800_000_000_000,
  ...patch,
});
const human = (patch: Partial<NeedsHumanItem> = {}): NeedsHumanItem => ({
  id: "h1",
  accountId: "acc1",
  platform: "linkedin",
  reason: "challenge",
  at: 1_800_000_000_100,
  ...patch,
});
const NOW = 1_800_000_000_000;
const account = (id: string, patch: Record<string, unknown> = {}) => ({
  id,
  platform: "x" as const,
  grants: { p1: ["draft" as const] },
  connected: true,
  paused: false,
  ...patch,
});
const item = (patch: Partial<SocialWaitingItem> = {}): SocialWaitingItem => ({
  id: "request:r1",
  kind: "accountRequest",
  platform: "x",
  paths: ["/work/app"],
  at: Date.now(),
  ...patch,
});

beforeEach(() => {
  localStorage.clear();
  locked.clear();
  invoke.mockReset();
  invoke.mockResolvedValue(true);
  saveNotificationsEnabled(true);
  setWindowFocused(false);
  setSocialWaitingCount(0);
});

it("maps pending requests and waiting browser tasks to items with their project paths", () => {
  const items = buildSocialWaiting({
    requests: [request(), request({ id: "r2", status: "dismissed" })],
    humans: [human(), human({ id: "h2", accountId: "none" })],
    accounts: [{ ...account("acc1"), grants: { p1: ["draft"], p2: [], p3: ["draft"] } }],
    pathOfProject: new Map([
      ["p1", "/work/app"],
      ["p2", "/work/other"],
      ["p3", "/work/third"],
    ]),
    now: NOW,
  });
  expect(items.map((entry) => [entry.id, entry.paths])).toEqual([
    ["request:r1", ["/work/app"]],
    ["human:h1", ["/work/app", "/work/third"]],
    ["human:h2", []],
  ]);
  expect(items[1]).toMatchObject({ kind: "needsHuman", reason: "challenge", platform: "linkedin" });
});

const signIns = (accounts: ReturnType<typeof account>[], now = NOW) =>
  buildSocialWaiting({
    requests: [],
    humans: [],
    accounts,
    pathOfProject: new Map([["p1", "/work/app"]]),
    now,
  });

it("lists a connected, unpaused account whose session expired, keyed by its expiry", () => {
  const [entry] = signIns([account("b1", { connection: "browser", expiresAt: NOW - 1000 })]);
  expect(entry).toMatchObject({
    id: `signin:b1:${NOW - 1000}`,
    kind: "signIn",
    accountId: "b1",
    platform: "x",
    paths: ["/work/app"],
  });
  expect(signIns([account("a", { connection: "browser" })])).toEqual([]);
  expect(signIns([account("a", { connected: false, expiresAt: 1 })])).toEqual([]);
  expect(signIns([account("a", { paused: true, expiresAt: 1 })])).toEqual([]);
  expect(signIns([account("a", { expiresAt: NOW + 5000 })])).toEqual([]);
});

it("gives API accounts 15 minutes for the Host refresh before asking for a sign-in", () => {
  const expired = (ago: number) => signIns([account("o1", { expiresAt: NOW - ago })]);
  expect(expired(14 * 60_000)).toEqual([]);
  expect(expired(15 * 60_000)).toHaveLength(1);
});

it("announces a later expiry of the same account again and drops a reconnected one", () => {
  const first = signIns([account("o1", { expiresAt: NOW - 20 * 60_000 })])[0];
  const again = signIns([account("o1", { expiresAt: NOW - 16 * 60_000 })], NOW)[0];
  expect(again.id).not.toBe(first.id);
  rememberAnnouncedSocial([first.id]);
  expect(loadAnnouncedSocial().has(again.id)).toBe(false);
  expect(signIns([account("o1", { expiresAt: NOW + 3_600_000 })])).toEqual([]);
});

it("logs a sign-in item that opens Accounts on that account, without the account name", async () => {
  const [entry] = signIns([account("o1", { expiresAt: NOW - 20 * 60_000, name: "Secret brand" })]);
  await notifySocialWaiting([entry]);
  const [logEntry] = await logged(1);
  expect(logEntry.target).toBe("background:social-accounts:o1");
  expect(logEntry.title).toBe("Sign in again");
  expect(logEntry.label).toBe("X · Sign-in needed");
  const [, payload] = banners()[0];
  expect(payload).toMatchObject({ sessionId: "background:social-accounts:o1" });
  expect(JSON.stringify([logEntry, payload])).not.toMatch(/Secret|work/);
});

it("remembers announced ids across reads and keeps only the newest", () => {
  rememberAnnouncedSocial(["a", "b"]);
  rememberAnnouncedSocial(["b", "c"]);
  expect([...loadAnnouncedSocial()]).toEqual(["a", "b", "c"]);
  rememberAnnouncedSocial(Array.from({ length: 400 }, (_, index) => `x${index}`));
  const kept = loadAnnouncedSocial();
  expect(kept.size).toBe(300);
  expect(kept.has("x399")).toBe(true);
  expect(kept.has("a")).toBe(false);
});

it("logs and banners one item, with the platform and reason but no project or request text", async () => {
  await expect(notifySocialWaiting([item()])).resolves.toBe(true);
  const [entry] = await logged(1);
  expect(entry).toMatchObject({
    kind: "background",
    key: "social:request:r1",
    target: BACKGROUND_NOTIFICATION_TARGETS.social,
  });
  const [, payload] = banners()[0];
  expect(payload).toMatchObject({ sessionId: "background:social", title: "Account request" });
  expect(JSON.stringify([entry, payload])).not.toMatch(/work|app\b|Private/);
});

it("sends one summary banner for a burst and one log entry per item", async () => {
  await notifySocialWaiting([
    item(),
    item({ id: "human:h1", kind: "needsHuman", reason: "login", platform: "linkedin" }),
  ]);
  expect(banners()).toHaveLength(1);
  expect(banners()[0][1]).toMatchObject({
    title: "Social Media",
    body: "2 items are waiting for you",
  });
  expect(await logged(2)).toHaveLength(2);
});

it("still logs when banners are off or the window is focused, without a banner", async () => {
  saveNotificationsEnabled(false);
  await expect(notifySocialWaiting([item()])).resolves.toBe(false);
  saveNotificationsEnabled(true);
  setWindowFocused(true);
  await expect(notifySocialWaiting([item({ id: "request:r2" })])).resolves.toBe(false);
  expect(banners()).toEqual([]);
  expect(await logged(2)).toHaveLength(2);
});

it("does nothing when the needs-your-input event is off", async () => {
  saveNotificationEvent("input", false);
  await expect(notifySocialWaiting([item()])).resolves.toBe(false);
  expect(readNotificationHistory()).toEqual([]);
  expect(banners()).toEqual([]);
});

it("skips a muted project and a browser task only when every granted project is muted", async () => {
  updateNotificationPreferences(["local:/work/app"], { mutedUntil: null });
  const muted = item({ paths: ["/work/app"] });
  const partly = item({ id: "human:h1", paths: ["/work/app", "/work/open"] });
  expect(socialWaitingVisibility(muted)).toBe("muted");
  expect(socialWaitingVisibility(partly)).toBe("open");
  expect(socialWaitingVisibility(muted, { indicator: true })).toBe("muted");
  expect(socialWaitingVisibility(item({ paths: [] }))).toBe("open");
  await notifySocialWaiting([muted]);
  expect(readNotificationHistory()).toEqual([]);
  expect(banners()).toEqual([]);
});

it("masks a locked project: logged without text, no banner, not counted", async () => {
  locked.add("/work/app");
  expect(socialWaitingVisibility(item())).toBe("locked");
  await expect(notifySocialWaiting([item()])).resolves.toBe(false);
  const [entry] = await logged(1);
  expect(entry.title).toBe("");
  expect(entry.label).not.toMatch(/X|account/i);
  expect(banners()).toEqual([]);
});

it("targets the Command screen through the shared background target", () => {
  expect(BACKGROUND_NOTIFICATION_TARGETS.social).toBe("background:social");
});

it("publishes the waiting count to listeners once per change", () => {
  const listener = vi.fn();
  const off = subscribeSocialWaiting(listener);
  setSocialWaitingCount(2);
  setSocialWaitingCount(2);
  expect(socialWaitingCount()).toBe(2);
  expect(listener).toHaveBeenCalledOnce();
  off();
});
