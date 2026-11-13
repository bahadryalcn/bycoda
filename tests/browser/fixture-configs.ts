import c0 from "./app-shell/compact-navigation.playwright.config.ts";
import attachmentCards from "./chat/attachment-cards.playwright.config.ts";
import sessionRowLayout from "./sessions/session-row-layout.playwright.config.ts";
import folderPicker from "./projects/folder-picker.playwright.config.ts";
import c1 from "./chat/composer-host-compatibility.playwright.config.ts";
import c2 from "./chat/edit-from-here.playwright.config.ts";
import c3 from "./shared-ui/playwright.arc-controls.config.ts";
import c4 from "./automations/playwright.automations.config.ts";
import c5 from "./host-tools/playwright.browser-annotation.config.ts";
import c6 from "./chat/playwright.chat-artifacts.config.ts";
import c7 from "./chat/playwright.composer.config.ts";
import c8 from "./connections/playwright.connections.config.ts";
import c9 from "./crews/playwright.crew.config.ts";
import c10 from "./crews/playwright.crews.config.ts";
import c11 from "./devices/playwright.device-panel.config.ts";
import c12 from "./files/playwright.editor-navigation.config.ts";
import c13 from "./files/playwright.editor-selection.config.ts";
import c14 from "./settings/playwright.external-mcp.config.ts";
import c15 from "./source-control/playwright.git-checkouts.config.ts";
import c16 from "./shared-ui/playwright.group-menu.config.ts";
import c17 from "./host-tools/playwright.host-tools.config.ts";
import c18 from "./inbox/playwright.jira-board.config.ts";
import c19 from "./files/playwright.merge-conflicts.config.ts";
import c20 from "./notes/playwright.notes.config.ts";
import c21 from "./notifications/playwright.notifications.config.ts";
import c22 from "./onboarding/playwright.onboarding.config.ts";
import c23 from "./host-tools/playwright.operational-tools.config.ts";
import c24 from "./orchestration/playwright.orchestration.config.ts";
import c25 from "./chat/playwright.question-flow.config.ts";
import c26 from "./terminal/playwright.servers.config.ts";
import c27 from "./sessions/playwright.session-usability.config.ts";
import c28 from "./chat/playwright.sessions.config.ts";
import c29 from "./settings/playwright.settings.config.ts";
import settingsCollectionVisual from "./settings/playwright.collection-visual.config.ts";
import c30 from "./social/playwright.social.config.ts";
import c31 from "./tasks/playwright.sprints.config.ts";
import c32 from "./chat/playwright.subagent-relay.config.ts";
import c33 from "./tasks/playwright.tasks.config.ts";
import c34 from "./terminal/playwright.terminal-tools.config.ts";
import c35 from "./terminal/playwright.termius.config.ts";
import c36 from "./chat/playwright.text-actions.config.ts";
import c37 from "./host-tools/playwright.tools-simplify.config.ts";
import c38 from "./usage/playwright.usage-budgets.config.ts";
import c39 from "./voice/playwright.voice-visual-styles.config.ts";
import c40 from "./workspace/playwright.workspace-navigation.config.ts";
import c41 from "./source-control/playwright.worktrees.config.ts";
import c42 from "./sessions/session-deletion.config.ts";
import c43 from "./sessions/session-recovery.playwright.config.ts";
import c44 from "./app-shell/update-footer.playwright.config.ts";
import c45 from "./chat/transcript.playwright.config.ts";
import c46 from "./shared-ui/playwright.overlays.config.ts";
import c47 from "./sessions/playwright.session-references.config.ts";
import c48 from "./chat/playwright.composer-compact.config.ts";
import c49 from "./shared-ui/playwright.field-message.config.ts";
import c50 from "./shared-ui/tooltip-policy.playwright.config.ts";
import c51 from "./voice/playwright.global-voice.config.ts";
import assistantRoom from "./assistant/playwright.assistant-room.config.ts";
import assistantSettings from "./assistant/playwright.assistant-settings.config.ts";
import generatedFileLinks from "./chat/generated-file-links.playwright.config.ts";
import inlineVisuals from "./chat/playwright.inline-visuals.config.ts";
import chatCitations from "./chat/playwright.chat-citations.config.ts";
import renderBudget from "./render-budget/playwright.render-budget.config.ts";
import workingProjectSummary from "./workspace/working-project-summary.playwright.config.ts";
import assistantRoomRemote from "./assistant/playwright.assistant-room-remote.config.ts";
import devices from "./devices/playwright.devices.config.ts";
import dictationPermissions from "./voice/playwright.dictation-permissions.config.ts";
import inboxSeenStorage from "./inbox/playwright.inbox-seen-storage.config.ts";
import s31OutboxStorage from "./sessions/playwright.s31-outbox-storage.config.ts";
import sessionTools from "./sessions/playwright.session-tools.config.ts";
import skillCatalog from "./skills/playwright.skill-catalog.config.ts";
import titleSettings from "./settings/playwright.title-settings.config.ts";
import messagingIntegrations from "./messaging/messaging-integrations.playwright.config.ts";

import canvasPaired from "./crews/playwright.canvas-paired.config.ts";

export const fixtureConfigs = {
  "tests/browser/projects/folder-picker.playwright.config.ts": folderPicker,
  "tests/browser/crews/playwright.canvas-paired.config.ts": canvasPaired,
  "tests/browser/chat/playwright.inline-visuals.config.ts": inlineVisuals,
  "tests/browser/chat/playwright.chat-citations.config.ts": chatCitations,
  "tests/browser/workspace/working-project-summary.playwright.config.ts": workingProjectSummary,
  "tests/browser/render-budget/playwright.render-budget.config.ts": renderBudget,
  "tests/browser/chat/attachment-cards.playwright.config.ts": attachmentCards,
  "tests/browser/sessions/session-row-layout.playwright.config.ts": sessionRowLayout,
  "tests/browser/chat/generated-file-links.playwright.config.ts": generatedFileLinks,
  "tests/browser/assistant/playwright.assistant-room.config.ts": assistantRoom,
  "tests/browser/assistant/playwright.assistant-settings.config.ts": assistantSettings,
  "tests/browser/app-shell/compact-navigation.playwright.config.ts": c0,
  "tests/browser/chat/composer-host-compatibility.playwright.config.ts": c1,
  "tests/browser/chat/edit-from-here.playwright.config.ts": c2,
  "tests/browser/shared-ui/playwright.arc-controls.config.ts": c3,
  "tests/browser/automations/playwright.automations.config.ts": c4,
  "tests/browser/host-tools/playwright.browser-annotation.config.ts": c5,
  "tests/browser/chat/playwright.chat-artifacts.config.ts": c6,
  "tests/browser/chat/playwright.composer.config.ts": c7,
  "tests/browser/connections/playwright.connections.config.ts": c8,
  "tests/browser/crews/playwright.crew.config.ts": c9,
  "tests/browser/crews/playwright.crews.config.ts": c10,
  "tests/browser/devices/playwright.device-panel.config.ts": c11,
  "tests/browser/files/playwright.editor-navigation.config.ts": c12,
  "tests/browser/files/playwright.editor-selection.config.ts": c13,
  "tests/browser/settings/playwright.external-mcp.config.ts": c14,
  "tests/browser/source-control/playwright.git-checkouts.config.ts": c15,
  "tests/browser/shared-ui/playwright.group-menu.config.ts": c16,
  "tests/browser/host-tools/playwright.host-tools.config.ts": c17,
  "tests/browser/inbox/playwright.jira-board.config.ts": c18,
  "tests/browser/files/playwright.merge-conflicts.config.ts": c19,
  "tests/browser/notes/playwright.notes.config.ts": c20,
  "tests/browser/notifications/playwright.notifications.config.ts": c21,
  "tests/browser/onboarding/playwright.onboarding.config.ts": c22,
  "tests/browser/host-tools/playwright.operational-tools.config.ts": c23,
  "tests/browser/orchestration/playwright.orchestration.config.ts": c24,
  "tests/browser/chat/playwright.question-flow.config.ts": c25,
  "tests/browser/terminal/playwright.servers.config.ts": c26,
  "tests/browser/sessions/playwright.session-usability.config.ts": c27,
  "tests/browser/chat/playwright.sessions.config.ts": c28,
  "tests/browser/settings/playwright.settings.config.ts": c29,
  "tests/browser/settings/playwright.collection-visual.config.ts": settingsCollectionVisual,
  "tests/browser/social/playwright.social.config.ts": c30,
  "tests/browser/tasks/playwright.sprints.config.ts": c31,
  "tests/browser/chat/playwright.subagent-relay.config.ts": c32,
  "tests/browser/tasks/playwright.tasks.config.ts": c33,
  "tests/browser/terminal/playwright.terminal-tools.config.ts": c34,
  "tests/browser/terminal/playwright.termius.config.ts": c35,
  "tests/browser/chat/playwright.text-actions.config.ts": c36,
  "tests/browser/host-tools/playwright.tools-simplify.config.ts": c37,
  "tests/browser/usage/playwright.usage-budgets.config.ts": c38,
  "tests/browser/voice/playwright.voice-visual-styles.config.ts": c39,
  "tests/browser/workspace/playwright.workspace-navigation.config.ts": c40,
  "tests/browser/source-control/playwright.worktrees.config.ts": c41,
  "tests/browser/sessions/session-deletion.config.ts": c42,
  "tests/browser/sessions/session-recovery.playwright.config.ts": c43,
  "tests/browser/app-shell/update-footer.playwright.config.ts": c44,
  "tests/browser/chat/transcript.playwright.config.ts": c45,
  "tests/browser/shared-ui/playwright.overlays.config.ts": c46,
  "tests/browser/sessions/playwright.session-references.config.ts": c47,
  "tests/browser/chat/playwright.composer-compact.config.ts": c48,
  "tests/browser/shared-ui/playwright.field-message.config.ts": c49,
  "tests/browser/shared-ui/tooltip-policy.playwright.config.ts": c50,
  "tests/browser/voice/playwright.global-voice.config.ts": c51,
  "tests/browser/assistant/playwright.assistant-room-remote.config.ts": assistantRoomRemote,
  "tests/browser/devices/playwright.devices.config.ts": devices,
  "tests/browser/voice/playwright.dictation-permissions.config.ts": dictationPermissions,
  "tests/browser/inbox/playwright.inbox-seen-storage.config.ts": inboxSeenStorage,
  "tests/browser/sessions/playwright.s31-outbox-storage.config.ts": s31OutboxStorage,
  "tests/browser/sessions/playwright.session-tools.config.ts": sessionTools,
  "tests/browser/skills/playwright.skill-catalog.config.ts": skillCatalog,
  "tests/browser/settings/playwright.title-settings.config.ts": titleSettings,
  "tests/browser/messaging/messaging-integrations.playwright.config.ts": messagingIntegrations,
};
