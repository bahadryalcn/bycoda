import c0 from "./compact-navigation.playwright.config.ts";
import attachmentCards from "./attachment-cards.playwright.config.ts";
import sessionRowLayout from "./session-row-layout.playwright.config.ts";
import c1 from "./composer-host-compatibility.playwright.config.ts";
import c2 from "./edit-from-here.playwright.config.ts";
import c3 from "./playwright.arc-controls.config.ts";
import c4 from "./playwright.automations.config.ts";
import c5 from "./playwright.browser-annotation.config.ts";
import c6 from "./playwright.chat-artifacts.config.ts";
import c7 from "./playwright.composer.config.ts";
import c8 from "./playwright.connections.config.ts";
import c9 from "./playwright.crew.config.ts";
import c10 from "./playwright.crews.config.ts";
import c11 from "./playwright.device-panel.config.ts";
import c12 from "./playwright.editor-navigation.config.ts";
import c13 from "./playwright.editor-selection.config.ts";
import c14 from "./playwright.external-mcp.config.ts";
import c15 from "./playwright.git-checkouts.config.ts";
import c16 from "./playwright.group-menu.config.ts";
import c17 from "./playwright.host-tools.config.ts";
import c18 from "./playwright.jira-board.config.ts";
import c19 from "./playwright.merge-conflicts.config.ts";
import c20 from "./playwright.notes.config.ts";
import c21 from "./playwright.notifications.config.ts";
import c22 from "./playwright.onboarding.config.ts";
import c23 from "./playwright.operational-tools.config.ts";
import c24 from "./playwright.orchestration.config.ts";
import c25 from "./playwright.question-flow.config.ts";
import c26 from "./playwright.servers.config.ts";
import c27 from "./playwright.session-usability.config.ts";
import c28 from "./playwright.sessions.config.ts";
import c29 from "./playwright.settings.config.ts";
import c30 from "./playwright.social.config.ts";
import c31 from "./playwright.sprints.config.ts";
import c32 from "./playwright.subagent-relay.config.ts";
import c33 from "./playwright.tasks.config.ts";
import c34 from "./playwright.terminal-tools.config.ts";
import c35 from "./playwright.termius.config.ts";
import c36 from "./playwright.text-actions.config.ts";
import c37 from "./playwright.tools-simplify.config.ts";
import c38 from "./playwright.usage-budgets.config.ts";
import c39 from "./playwright.voice-visual-styles.config.ts";
import c40 from "./playwright.workspace-navigation.config.ts";
import c41 from "./playwright.worktrees.config.ts";
import c42 from "./session-deletion.config.ts";
import c43 from "./session-recovery.playwright.config.ts";
import c44 from "./update-footer.playwright.config.ts";
import c45 from "./transcript.playwright.config.ts";
import c46 from "./playwright.overlays.config.ts";
import c47 from "./playwright.session-references.config.ts";
import c48 from "./playwright.composer-compact.config.ts";
import c49 from "./playwright.field-message.config.ts";
import c50 from "./tooltip-policy.playwright.config.ts";
import c51 from "./playwright.global-voice.config.ts";
import assistantRoom from "./playwright.assistant-room.config.ts";
import assistantSettings from "./playwright.assistant-settings.config.ts";
import generatedFileLinks from "./generated-file-links.playwright.config.ts";
import inlineVisuals from "./playwright.inline-visuals.config.ts";
import chatCitations from "./playwright.chat-citations.config.ts";
import workingProjectSummary from "./working-project-summary.playwright.config.ts";

export const fixtureConfigs = {
  "tests/browser/playwright.inline-visuals.config.ts": inlineVisuals,
  "tests/browser/playwright.chat-citations.config.ts": chatCitations,
  "tests/browser/working-project-summary.playwright.config.ts": workingProjectSummary,
  "tests/browser/attachment-cards.playwright.config.ts": attachmentCards,
  "tests/browser/session-row-layout.playwright.config.ts": sessionRowLayout,
  "tests/browser/generated-file-links.playwright.config.ts": generatedFileLinks,
  "tests/browser/playwright.assistant-room.config.ts": assistantRoom,
  "tests/browser/playwright.assistant-settings.config.ts": assistantSettings,
  "tests/browser/compact-navigation.playwright.config.ts": c0,
  "tests/browser/composer-host-compatibility.playwright.config.ts": c1,
  "tests/browser/edit-from-here.playwright.config.ts": c2,
  "tests/browser/playwright.arc-controls.config.ts": c3,
  "tests/browser/playwright.automations.config.ts": c4,
  "tests/browser/playwright.browser-annotation.config.ts": c5,
  "tests/browser/playwright.chat-artifacts.config.ts": c6,
  "tests/browser/playwright.composer.config.ts": c7,
  "tests/browser/playwright.connections.config.ts": c8,
  "tests/browser/playwright.crew.config.ts": c9,
  "tests/browser/playwright.crews.config.ts": c10,
  "tests/browser/playwright.device-panel.config.ts": c11,
  "tests/browser/playwright.editor-navigation.config.ts": c12,
  "tests/browser/playwright.editor-selection.config.ts": c13,
  "tests/browser/playwright.external-mcp.config.ts": c14,
  "tests/browser/playwright.git-checkouts.config.ts": c15,
  "tests/browser/playwright.group-menu.config.ts": c16,
  "tests/browser/playwright.host-tools.config.ts": c17,
  "tests/browser/playwright.jira-board.config.ts": c18,
  "tests/browser/playwright.merge-conflicts.config.ts": c19,
  "tests/browser/playwright.notes.config.ts": c20,
  "tests/browser/playwright.notifications.config.ts": c21,
  "tests/browser/playwright.onboarding.config.ts": c22,
  "tests/browser/playwright.operational-tools.config.ts": c23,
  "tests/browser/playwright.orchestration.config.ts": c24,
  "tests/browser/playwright.question-flow.config.ts": c25,
  "tests/browser/playwright.servers.config.ts": c26,
  "tests/browser/playwright.session-usability.config.ts": c27,
  "tests/browser/playwright.sessions.config.ts": c28,
  "tests/browser/playwright.settings.config.ts": c29,
  "tests/browser/playwright.social.config.ts": c30,
  "tests/browser/playwright.sprints.config.ts": c31,
  "tests/browser/playwright.subagent-relay.config.ts": c32,
  "tests/browser/playwright.tasks.config.ts": c33,
  "tests/browser/playwright.terminal-tools.config.ts": c34,
  "tests/browser/playwright.termius.config.ts": c35,
  "tests/browser/playwright.text-actions.config.ts": c36,
  "tests/browser/playwright.tools-simplify.config.ts": c37,
  "tests/browser/playwright.usage-budgets.config.ts": c38,
  "tests/browser/playwright.voice-visual-styles.config.ts": c39,
  "tests/browser/playwright.workspace-navigation.config.ts": c40,
  "tests/browser/playwright.worktrees.config.ts": c41,
  "tests/browser/session-deletion.config.ts": c42,
  "tests/browser/session-recovery.playwright.config.ts": c43,
  "tests/browser/update-footer.playwright.config.ts": c44,
  "tests/browser/transcript.playwright.config.ts": c45,
  "tests/browser/playwright.overlays.config.ts": c46,
  "tests/browser/playwright.session-references.config.ts": c47,
  "tests/browser/playwright.composer-compact.config.ts": c48,
  "tests/browser/playwright.field-message.config.ts": c49,
  "tests/browser/tooltip-policy.playwright.config.ts": c50,
  "tests/browser/playwright.global-voice.config.ts": c51,
};
