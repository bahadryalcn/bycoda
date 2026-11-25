// @vitest-environment node
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const surfaces = [
  ["app/shell/SidebarSessionSearch.tsx", "Search"],
  ["app/shell/Sidebar.tsx", "Search projects"],
  ["app/shell/BootLoading.tsx", "Restoring your workspace and saved drafts"],
  ["features/projects/ui/SearchableProjectPicker.tsx", "Search projects"],
  ["features/source-control/ui/BranchPicker.tsx", "Search or create a branch"],
  ["features/source-control/ui/SidebarWorktreeSwitcher.tsx", "Search or create a worktree"],
  ["features/inbox/ui/CheckRepairForm.tsx", "Search chats"],
  ["features/inbox/ui/InboxComments.tsx", "Posting"],
  ["features/inbox/ui/InboxDetail.tsx", "Sending"],
  ["features/sessions/ui/AgentTranscript.tsx", "Sending"],
  ["features/voice/ui/VoiceOverlayWindow.tsx", "Connecting voice"],
  ["features/group-lock/ui/GroupLockSettings.tsx", "Updating"],
] as const;

it.each(surfaces)("uses the ellipsis character in %s", (path, message) => {
  const source = readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
  expect(source).toContain(`t("${message}…")`);
  expect(source).not.toContain(`t("${message}...")`);
});

it.each(["de", "en", "es", "fr", "ja", "pt", "tr", "zh-CN"])(
  "uses the canonical message keys in %s",
  (locale) => {
    const catalog = JSON.parse(
      readFileSync(new URL(`./locales/${locale}.json`, import.meta.url), "utf8"),
    );
    for (const message of new Set(surfaces.map(([, message]) => message))) {
      expect(catalog[`${message}…`], message).toEqual(expect.any(String));
      expect(catalog, message).not.toHaveProperty([`${message}...`]);
    }
  },
);
