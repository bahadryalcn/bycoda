/**
 * Appearance ownership rules of the UI drift ratchet (check-ui-drift.mjs runs them).
 *
 * Feature and app code places things; it does not choose how they look. Type, surfaces,
 * interaction states, control sizes, truncation, motion and scrollbars come from a shared
 * component (docs/reference/ui-components.md). Layout stays free in feature code: display, grid,
 * flex, gap, margin, width, overflow and alignment are never reported here; only a literal
 * spacing value off the scale is.
 *
 * A rule bans properties, not component names. Each one is counted per file in the baseline, so
 * existing code stays as debt and only new findings fail.
 */

export const appearanceRules = {
  "feature-typography":
    "type chosen in feature code: font-size, font-weight, line-height, letter-spacing or text color, in CSS or as text-*/font-*/leading-*/tracking-* classes (use Text, including semantic containers; Heading for a title, SectionLabel for a group caption, Code for a literal, OutputBlock for command or log output (leading for line height), DiffStat for added and removed line counts; Timestamp, MiddleTruncate and LiveText take size and tone)",
  "surface-style":
    "surface drawn in feature code: border, outline, border-radius, background or box-shadow, in CSS or as border/rounded/bg-*/shadow/ring/outline/divide classes (use Surface, Divider, FieldGroup)",
  "interaction-state":
    "interaction state styled in feature code: :hover, :active, :focus*, [aria-selected] selectors or hover:/active:/focus*:/aria-selected: classes (use Button, Button variant=item, ActionHost, TreeRow, MenuRow, Tabs)",
  "text-truncation":
    "truncation written in feature code: text-overflow, line-clamp, truncate, text-ellipsis (one line: Text truncate; several lines: ClampText, with expandable={false} for a cut without the Show more action; a path or id: MiddleTruncate)",
  "feature-motion":
    "motion written in feature code: transition or animation, in CSS or as transition/animate-*/duration-*/ease-*/delay-* classes (use Motion; waiting states are Spinner, LoadingText, Skeleton, WorkingIndicator)",
  "scrollbar-style":
    "scrollbar styled in feature code: scrollbar-* properties, ::-webkit-scrollbar or scrollbar-* classes (use ScrollArea)",
  "inline-style-property":
    'style={{ … }} sets a CSS property directly; an inline style may only carry custom properties (style={{ "--x": value }}) that a class reads',
  "spacing-step":
    "gap, padding or margin with a literal off the spacing scale: a bare px/rem value other than 0, 4, 6, 8, 10, 12, 14, 16, 20 or 24 px, or a Tailwind step other than 0, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6 (var(--space-*) is always allowed)",
};

/**
 * Surfaces that own their look by design: the transcript and its markdown output, the chat
 * composer editor, the terminal, code and diff editors, document and media viewers, the
 * appearance previews and drawn scenes. The appearance rules skip exactly these files; every other UI drift rule
 * still applies. A file is listed by path, never matched by a word in its name: a toggle, menu or
 * toolbar that sits next to a bespoke surface is an ordinary control.
 */
export const bespokeSurfaces = new Set([
  // Runtime log rows use severity and source inks.
  "src/features/host-tools/runtime-logs.css",
  // Runtime log viewer owns its structured output presentation.
  "src/features/host-tools/RuntimeLogsPanel.tsx",
  // Runtime log rows render severity and source data.
  "src/features/host-tools/ui/RuntimeLogRow.tsx",
  // Runtime log object tree renders structured log values.
  "src/features/host-tools/ui/RuntimeLogObjectInspector.tsx",
  // Host tool output owns its muted ink.
  "src/features/host-tools/host-tools.css",
  // Diagnostics output uses host tool ink.
  "src/features/host-tools/diagnostics-panel.css",
  // Server output uses host tool ink.
  "src/features/host-tools/dev-servers.css",
  // Syntax preview renders syntax-specific colors.
  "src/features/settings/ui/appearance/controls/TypographySamples.css",
  // Recovery lists share a specialized overflow contract.
  "src/app/shell/session-recovery.css",
  // Editor slot owns its scrolling element.
  "src/features/quick-composer/ui/QuickComposer.tsx",
  // TabList owns its scrolling element.
  "src/features/workspace/ui/SurfaceTabs.tsx",
  // Scrollbar preview draws the configured scrollbar.
  "src/features/settings/ui/appearance/controls/ScrollbarGroup.tsx",
  // Transcript and markdown output
  "src/features/sessions/ui/AgentTranscript.tsx",
  "src/features/sessions/ui/AgentTranscriptActivity.tsx",
  "src/features/sessions/ui/TranscriptVirtualRows.tsx",
  "src/features/sessions/ui/AgentMarkdown.tsx",
  "src/features/sessions/ui/MarkdownDocumentPreview.tsx",
  "src/features/voice/ui/companion/VoiceChatTranscript.tsx",
  // Chat composer editor
  "src/features/sessions/ui/Composer.tsx",
  "src/features/sessions/ui/ComposerHighlight.tsx",
  "src/features/sessions/ui/ComposerHighlight.module.css",
  "src/features/sessions/ui/ComposerAttachmentHighlight.tsx",
  "src/features/sessions/ui/ComposerAttachmentHighlight.module.css",
  // Terminal
  "src/features/terminal/ui/TerminalView.tsx",
  "src/features/terminal/ui/TerminalGhostText.tsx",
  "src/features/terminal/ui/terminal.css",
  "src/features/connections/ui/ServerTerminalSession.tsx",
  "src/features/connections/ui/ServerTerminalSession.module.css",
  // Code and diff editors
  "src/features/files/ui/CodeMirrorEditor.tsx",
  "src/features/notes/ui/NoteMarkdownEditor.tsx",
  "src/features/source-control/ui/MergeConflictEditor.tsx",
  "src/features/source-control/ui/GitGraphConflictEditor.tsx",
  "src/features/source-control/ui/UnifiedDiffView.tsx",
  "src/features/source-control/ui/UnifiedDiffView.css",
  "src/features/source-control/ui/DiffOverviewRuler.tsx",
  "src/features/sessions/ui/ToolDiffPreview.tsx",
  // Document and media viewers
  "src/features/files/ui/DocxViewer.tsx",
  "src/features/files/ui/PdfViewer.tsx",
  "src/features/files/ui/SheetViewer.tsx",
  "src/features/files/ui/pdfTextLayer.css",
  "src/features/files/ui/MediaView.tsx",
  "src/features/files/ui/HtmlPreview.tsx",
  "src/features/sessions/ui/LocalMedia.tsx",
  "src/features/sessions/ui/TranscriptImagePreview.tsx",
  "src/features/inbox/ui/InboxMedia.tsx",
  // Canvas and scene drawing
  "src/features/sessions/ui/CrewScene.tsx",
  "src/features/sessions/ui/CrewScene.css",
  "src/features/sessions/ui/PacingUncle.tsx",
  // Appearance previews
  "src/features/settings/ui/AppearancePreviews.tsx",
  "src/features/settings/ui/AppearancePreviews.css",
  "src/features/settings/ui/LiveBackgroundCanvas.tsx",
  "src/features/settings/ui/LiveBackgroundCanvas.css",
  "src/features/settings/ui/appearance/controls/BackgroundPreview.tsx",
  "src/features/settings/ui/appearance/controls/BackgroundPreview.module.css",
  "src/features/settings/ui/appearance/controls/SidebarRowPreview.tsx",
  "src/features/settings/ui/appearance/controls/ThemePreview.tsx",
  "src/features/settings/ui/appearance/controls/TypographyPreview.tsx",
  "src/features/settings/ui/appearance/controls/SceneStrip.tsx",
  "src/features/settings/ui/appearance/controls/SceneStrip.module.css",
  // Drawn scenes
  "src/features/sessions/ui/CrewScene.tsx",
  "src/features/sessions/ui/CrewScene.css",
  "src/features/sessions/ui/PacingUncle.tsx",
]);

export const isBespokeSurface = (file) => bespokeSurfaces.has(file);

/**
 * Deliberate exceptions inside a file that is otherwise an ordinary feature file. An entry skips
 * only the findings it names; every other finding in the file still counts. `rules` limits it to
 * those appearance rules (every appearance rule when absent). `selector` matches a CSS rule: any
 * selector of the declaration's chain, so a `@keyframes` name or a media query is a chain member.
 * `token` matches a class (or an inline class table entry) or the declaration text, as a whole
 * word. An entry without `selector` and `token` covers the named rules in the whole file. Every
 * entry carries a one-line reason; prefer the narrowest one that works.
 */
export const bespokeParts = [
  {
    file: "src/features/onboarding/ui/onboarding.css",
    rules: ["feature-motion"],
    selector: /^\.onboarding-feature, \.onboarding-choice, \.onboarding-row$/,
    reason:
      "Contextual transition on shared Checkbox and RadioTileGroup generated hit areas; the controls own their motion.",
  },
  {
    file: "src/app/shell/UsageProviderChip.tsx",
    rules: ["feature-motion"],
    token: "motion-safe:animate-spin",
    reason: "Refresh glyph retains its meaning while refreshing.",
  },
  {
    file: "src/features/assistant/ui/AssistantPresenceIndicator.module.css",
    rules: ["feature-typography"],
    selector: new RegExp("^" + ".indicator".replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$"),
    reason: "Forced-colors system ink must remain CanvasText.",
  },
  {
    file: "src/features/assistant/ui/AssistantView.module.css",
    rules: ["feature-typography"],
    selector: new RegExp(
      "^" +
        ".scheduleSentence > :nth-last-child(-n + 2)".replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
        "$",
    ),
    reason:
      "Contextual override of shared TriggerEditor/ModelPicker roles generated by child components.",
  },
  {
    file: "src/features/assistant/ui/AssistantView.module.css",
    rules: ["feature-typography"],
    selector: new RegExp(
      "^" +
        '.modelField button:global(.model-picker-field-trigger)[data-model-picker-presentation="field"]'.replace(
          /[.*+?^${}()|[\]\\]/g,
          "\\$&",
        ) +
        "$",
    ),
    reason:
      "Contextual override of shared TriggerEditor/ModelPicker roles generated by child components.",
  },
  {
    file: "src/features/host-tools/browser-annotation.css",
    rules: ["feature-typography"],
    selector: new RegExp(
      "^" + ".host-browser-surface".replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$",
    ),
    reason: "Zero line-height removes inline media baseline space on the drawn browser surface.",
  },
  {
    file: "src/features/onboarding/ui/onboarding.css",
    rules: ["feature-typography"],
    selector: new RegExp("^" + ".onboarding-brand".replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$"),
    reason: "Decorative brand row or crew preview palette ink.",
  },
  {
    file: "src/features/onboarding/ui/onboarding.css",
    rules: ["feature-typography"],
    selector: new RegExp(
      "^" + ".onboarding-brand small".replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$",
    ),
    reason: "Decorative brand row or crew preview palette ink.",
  },
  {
    file: "src/features/onboarding/ui/onboarding.css",
    rules: ["feature-typography"],
    selector: new RegExp(
      "^" + ".onboarding-crew-preview".replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$",
    ),
    reason: "Decorative brand row or crew preview palette ink.",
  },
  {
    file: "src/features/onboarding/ui/usageGuide.css",
    rules: ["feature-motion"],
    selector: new RegExp("^" + ".usage-guide-scroll".replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$"),
    reason: "One-off guide entrance moves 4px, part of guided spotlight choreography.",
  },
  {
    file: "src/features/search/ui/search.css",
    rules: ["feature-typography"],
    selector: new RegExp(
      "^" + ".app-search-footer kbd".replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$",
    ),
    token: "inherit",
    reason: "Key cap font reset follows surrounding shortcut hint; not a text hierarchy choice.",
  },
  {
    file: "src/features/sessions/ui/AttachmentTokenText.module.css",
    rules: ["feature-typography"],
    selector: new RegExp("^" + ".token".replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$"),
    reason:
      "Relative attachment type follows surrounding prose; pseudo-element decoration is excluded by rule.",
  },
  {
    file: "src/features/sessions/ui/BycodaSession.css",
    rules: ["feature-typography"],
    selector: new RegExp(
      "^" + ".bycoda-empty .bycoda-wordmark".replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$",
    ),
    reason:
      "Decorative brand wordmark and generated AgentMarkdown heading retain their own typography.",
  },
  {
    file: "src/features/sessions/ui/BycodaSession.css",
    rules: ["feature-typography"],
    selector: new RegExp(
      "^" + ".bycoda-empty .bycoda-task-brief h1".replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$",
    ),
    reason:
      "Decorative brand wordmark and generated AgentMarkdown heading retain their own typography.",
  },
  {
    file: "src/features/sessions/ui/ChatCitationText.module.css",
    rules: ["feature-typography"],
    selector: new RegExp("^" + ".token".replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$"),
    reason: "Relative citation type follows surrounding prose.",
  },
  {
    file: "src/features/sessions/ui/DeliveryProgressNotice.tsx",
    rules: ["feature-motion"],
    token: "animate-spin",
    reason:
      "Pending CircleDashed retains semantic glyph; reduced-motion disable remains accessible.",
  },
  {
    file: "src/features/sessions/ui/DocumentImage.tsx",
    rules: ["feature-typography"],
    token: "text-[0.92em]",
    reason: "Relative image reference type follows surrounding prose.",
  },
  {
    file: "src/features/sessions/ui/SessionWorkingStatus.tsx",
    rules: ["feature-typography"],
    token: "text-(--color-active)",
    reason: "Active palette ink identifies running activity, not text hierarchy.",
  },
  {
    file: "src/features/sessions/ui/chat-controls.css",
    rules: ["text-truncation"],
    selector: new RegExp(
      "^" +
        ".activity-dock-summary > span, .activity-dock-summary [data-truncate]".replace(
          /[.*+?^${}()|[\]\\]/g,
          "\\$&",
        ) +
        "$",
    ),
    reason: "Responsive override restores wrapping of an already shared truncate role.",
  },
  {
    file: "src/features/sessions/ui/modeCommands.tsx",
    rules: ["feature-typography"],
    token: "text-transparent",
    reason: "Transparent first glyph is a layout mask, not readable text hierarchy.",
  },
  {
    file: "src/features/settings/ui/BycodaSettings.css",
    rules: ["feature-typography"],
    selector: new RegExp(
      "^" +
        ".settings-page-bar .settings-page-title[data-size]".replace(
          /[.*+?^${}()|[\]\\]/g,
          "\\$&",
        ) +
        "$",
    ),
    reason: "Page bar title line-height aligns the fixed control row grid.",
  },
  {
    file: "src/features/settings/ui/ProviderSettings.css",
    rules: ["feature-motion"],
    selector: new RegExp(
      "^" + ".provider-cli-more svg".replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$",
    ),
    reason: "Disclosure-generated chevron already owns the shared transform transition.",
  },
  {
    file: "src/features/settings/ui/ProviderSettings.tsx",
    rules: ["feature-typography"],
    token: "text-accent",
    reason: "Palette accent mark identifies provider installation, distinct from interaction ink.",
  },
  {
    file: "src/features/social/ui/common/common.css",
    rules: ["feature-typography"],
    selector: new RegExp(
      "^" + ".social-avatar-initials".replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$",
    ),
    reason: "Avatar initials scale with avatar box geometry, not hierarchy.",
  },
  {
    file: "src/features/source-control/ui/GitCommitBlameView.tsx",
    rules: ["feature-typography"],
    token: "leading-6",
    reason: "Fixed line height aligns blame rows to code grid; caption size migrates separately.",
  },
  {
    file: "src/features/source-control/ui/conflict-layout.css",
    rules: ["feature-typography"],
    selector: new RegExp(
      "^" +
        "[data-field-control] .conflict-result-textarea.conflict-result-textarea".replace(
          /[.*+?^${}()|[\]\\]/g,
          "\\$&",
        ) +
        "$",
    ),
    reason: "User-controlled code editor font size and line grid belong to code surface.",
  },
  {
    file: "src/features/voice/ui/VoiceToolActivityPanel.module.css",
    rules: ["feature-typography"],
    selector: new RegExp("^" + ".count".replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$"),
    reason:
      "Floating-surface badge ink is product contrast; breathing wrench retains its action meaning.",
  },
  {
    file: "src/features/voice/ui/VoiceToolActivityPanel.module.css",
    rules: ["feature-motion"],
    selector: new RegExp(
      "^" + ".trigger[data-running] :global(svg)".replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$",
    ),
    reason:
      "Floating-surface badge ink is product contrast; breathing wrench retains its action meaning.",
  },
  // One-off and drawn animations: timed to feature state, not waiting states.
  {
    file: "src/features/sessions/ui/PromptOutline.tsx",
    rules: ["feature-motion"],
    reason: "Wave bars ease width and opacity with a per-bar delay that Motion would reset.",
  },
  {
    file: "src/features/sessions/ui/PromptOutline.css",
    rules: ["feature-motion"],
    reason: "Wave bars ease width and opacity with a per-bar delay that Motion would reset.",
  },
  {
    file: "src/features/sessions/ui/ComposerTips.css",
    rules: ["feature-motion"],
    selector: /composer-tip-reveal/,
    reason: "One-off reveal of a rotating tip.",
  },
  {
    file: "src/features/settings/ui/BycodaSettings.css",
    rules: ["feature-motion"],
    selector: /\[data-revealed\]/,
    reason: "One-off flash that shows which setting a search result opened.",
  },
  {
    file: "src/app/shell/sessionList.css",
    rules: ["feature-motion"],
    selector: /session-row-dwell/,
    reason: "Drawn countdown ring while a dragged session rests on a card.",
  },
  {
    file: "src/app/shell/GithubStarPrompt.module.css",
    rules: ["feature-motion"],
    selector: /^\.dismiss$/,
    reason: "Dismiss fades opacity and visibility with a delay; Motion roles cannot express that.",
  },
  {
    file: "src/features/voice/ui/VoiceVisualizer.module.css",
    rules: ["feature-typography"],
    reason: "Drawn voice visualizer: state inks colour the SVG strokes and fills.",
  },
  {
    file: "src/features/voice/ui/VoiceCompanion.module.css",
    rules: ["feature-motion"],
    selector: /launcherDot|voice-launcher-pulse/,
    reason: "Launcher presence dot pulses while the voice session is live.",
  },
  {
    file: "src/features/voice/ui/VoiceOverlayWindow.module.css",
    rules: ["feature-motion"],
    selector: /\.side(?![\w-])/,
    reason: "The side panel slides in from the edge it docks to; Motion enter only rises.",
  },
  {
    file: "src/features/voice/ui/companion/VoiceCompanionParts.module.css",
    rules: ["feature-motion"],
    selector: /\.side(?![\w-])/,
    reason: "The side panel slides in from the edge it docks to; Motion enter only rises.",
  },
  {
    file: "src/features/sessions/ui/chat-controls.css",
    rules: ["feature-motion"],
    selector: /\.(?:context-speed-bolt|delivery-accepted|queue-departure)(?![\w-])/,
    reason: "Context charge, delivery accepted and queue departure are one-off keyframes.",
  },
  {
    file: "src/features/onboarding/ui/featureHighlights.css",
    rules: ["feature-motion"],
    selector: /feature-new-dot/,
    reason: "Attention ping of the new-feature dot.",
  },
  // Rules that style markup a shared component or a library generates.
  {
    file: "src/features/tasks/ui/tasks.css",
    selector: /\.agent-markdown/,
    reason: "Descendant rules for AgentMarkdown output, which the feature does not render itself.",
  },
  {
    file: "src/features/tasks/ui/task-detail.css",
    selector: /\.agent-markdown/,
    reason: "Descendant rules for AgentMarkdown output, which the feature does not render itself.",
  },
  {
    file: "src/features/assistant/ui/room/NotesTab.module.css",
    rules: ["feature-typography"],
    selector: /^\.markdown /,
    reason: "Heading scale for the AgentMarkdown output of a note.",
  },
  {
    file: "src/features/source-control/ui/conflict-layout.css",
    selector: /\.conflict-inline-choice/,
    reason: "Buttons are built as DOM nodes inside CodeMirror widgets, outside React.",
  },
  {
    file: "src/features/onboarding/ui/usageGuide.css",
    rules: ["feature-motion"],
    selector: /react-joyride/,
    reason: "Joyride's spotlight is third-party markup.",
  },
  // Specimens whose TSX is already a bespoke surface.
  {
    file: "src/features/settings/ui/appearance/controls/InterfaceSections.css",
    selector: /^\.(?:sidebar-row-preview|scrollbar-preview)/,
    reason: "Specimens of the sidebar row and the scrollbar that the Appearance settings change.",
  },
  {
    file: "src/features/settings/ui/appearance/controls/ThemeControls.css",
    selector: /^\.theme-preview/,
    reason: "Specimen of the theme that the Appearance settings change.",
  },
  // Product colours of one feature, not a text hierarchy tone.
  {
    file: "src/features/sessions/ui/SkillTokenText.tsx",
    rules: ["feature-typography"],
    token: "text-skill",
    reason: "Skill colour identifies skills wherever they appear.",
  },
  {
    file: "src/features/sessions/ui/SessionFolderPicker.tsx",
    rules: ["feature-typography"],
    token: "text-skill",
    reason: "Skill colour identifies skills wherever they appear.",
  },
  {
    file: "src/features/skills/ui/SkillPromptField.tsx",
    rules: ["feature-typography"],
    token: "text-skill",
    reason: "Skill colour identifies skills wherever they appear.",
  },
  {
    file: "src/features/sessions/ui/FileMentionPicker.tsx",
    rules: ["feature-typography"],
    token: "text-mention",
    reason: "Mention colour identifies file mentions wherever they appear.",
  },
  {
    file: "src/features/sessions/ui/modeCommands.tsx",
    rules: ["feature-typography"],
    token: "text-orchestration",
    reason: "Orchestration colour identifies orchestration commands.",
  },
  {
    file: "src/features/sessions/ui/AttachmentChip.module.css",
    rules: ["feature-typography"],
    token: "--chip-ink",
    reason: "Chip ink carries the attachment kind colour.",
  },
  {
    file: "src/features/sessions/ui/AttachmentTokenText.module.css",
    rules: ["feature-typography"],
    token: "--ui-attachment-ink",
    reason: "Attachment ink carries the attachment kind colour.",
  },
  {
    file: "src/features/assistant/ui/AssistantPresenceIndicator.module.css",
    rules: ["feature-typography"],
    token: "--presence-ink",
    reason: "Presence ink carries the assistant's availability colour.",
  },
  {
    file: "src/features/social/ui/common/activity-row.css",
    rules: ["feature-typography"],
    token: "--social-activity-fg",
    reason: "Activity ink carries the event's tone colour.",
  },
  {
    file: "src/features/terminal/ui/TerminalTools.module.css",
    rules: ["feature-typography"],
    token: "--ui-terminal-suggestion",
    reason: "Suggestion ink is the terminal's ghost-text colour.",
  },
];

const tokenPattern = (token) =>
  new RegExp(String.raw`(?<![\w-])${token.replace(/[$()*+.?[\\\]^{|}]/g, "\\$&")}(?![\w-])`);
const partTokens = new Map(
  bespokeParts.map((part) => [part, part.token && tokenPattern(part.token)]),
);

/**
 * True when a bespoke part exempts one finding: `selectors` is the CSS selector chain, `text` the
 * declaration (CSS) or the class (TSX) the finding points at.
 */
export function isBespokePart(file, rule, { selectors = [], text = "" } = {}) {
  return bespokeParts.some(
    (part) =>
      part.file === file &&
      (part.rules ?? Object.keys(appearanceRules)).includes(rule) &&
      (!part.selector || selectors.some((selector) => part.selector.test(selector))) &&
      (!part.token || partTokens.get(part).test(text)),
  );
}

/** The class token a TSX finding starts at, variants included. */
export const classTokenAt = (source, offset) =>
  /^[^\s"'`]*/.exec(source.slice(offset, offset + 120))[0];

// Variant prefixes may carry `/` (named containers/groups: @max-[950px]/main-row:) and `(` `)`
// (arbitrary values: has-(--x):); a narrower charset lets those classes escape every Tailwind rule.
export const variantChars = String.raw`[\w\-\[\]&@*=/().,%]`;
const variant = String.raw`(?<![\w\-\[(:/])((?:${variantChars}+:)*)`;
/** Lookahead that ends a Tailwind utility name. */
export const end = String.raw`(?![\w.\-])`;
/** A Tailwind utility with any variant prefix; the match starts at the first variant. */
export const tw = (body, flags = "g") => new RegExp(variant + body, flags);

const value = String.raw`[\w\[(]`;
const stateVariant = String.raw`(?:(?:group|peer)-)?(?:hover|active|focus(?:-visible|-within)?|aria-selected)(?:\/[\w-]+)?:`;
const spacingUtility = String.raw`-?(?:p|px|py|ps|pe|pt|pb|pl|pr|m|mx|my|ms|me|mt|mb|ml|mr|gap|gap-x|gap-y|space-x|space-y)`;

/** Order matters: a class reported by an earlier rule is not reported again by a later one. */
const classRules = [
  [
    "interaction-state",
    new RegExp(String.raw`(?<![\w\-\[(:/])(?:${variantChars}+:)*${stateVariant}[\w\-\[(!]`, "g"),
  ],
  ["feature-typography", tw(String.raw`text-(?:xs|sm|base|lg|xl|\dxl)` + end)],
  ["feature-typography", tw(String.raw`text-[\[(]`)],
  [
    "feature-typography",
    tw(
      String.raw`text-(?!left\b|center\b|right\b|justify\b|start\b|end\b|wrap\b|nowrap\b|balance\b|pretty\b|ellipsis\b|clip\b|xs\b|sm\b|base\b|lg\b|xl\b|\dxl\b)[a-z]`,
    ),
  ],
  [
    "feature-typography",
    tw(
      String.raw`font-(?:thin|extralight|light|normal|medium|semibold|bold|extrabold|black)` + end,
    ),
  ],
  ["feature-typography", tw(String.raw`(?:leading|tracking)-${value}`)],
  ["text-truncation", tw(String.raw`(?:truncate|text-ellipsis|text-clip)` + end)],
  ["text-truncation", tw(String.raw`line-clamp-${value}`)],
  ["surface-style", tw(String.raw`border(?!-collapse|-separate|-spacing)(?:-[\w\[(/.]+)*` + end)],
  ["surface-style", tw(String.raw`(?:rounded|shadow|ring|outline)(?:-[\w\[(/.]+)*` + end)],
  ["surface-style", tw(String.raw`(?:bg|divide)-${value}`)],
  ["feature-motion", tw(String.raw`transition(?:-[\w\[(]+)*` + end)],
  ["feature-motion", tw(String.raw`(?:animate|duration|ease|delay)-${value}`)],
  ["scrollbar-style", tw(String.raw`scrollbar-${value}`)],
  ["scrollbar-style", tw(String.raw`\[(?:&::-webkit-scrollbar|scrollbar-)`)],
];

const spacingClass = tw(String.raw`${spacingUtility}-(\d+(?:\.\d+)?|px)` + end);
const spacingSteps = new Set(["0", "1", "1.5", "2", "2.5", "3", "3.5", "4", "5", "6"]);
/** The same steps in px: 4 px per Tailwind step. */
const spacingPixels = new Set([...spacingSteps].map((step) => step * 4));
/** A bare px/rem length off the spacing scale; tokens, percentages and keywords are not lengths. */
const offScale = (part) => {
  const length = /^-?(\d*\.?\d+)(px|rem)$/.exec(part);
  return length !== null && !spacingPixels.has(length[1] * (length[2] === "rem" ? 16 : 1));
};

/** The balanced `{…}` (or `(…)`) that opens at `start`; returns the offset after its close. */
function balancedEnd(text, start, open, close) {
  let depth = 0;
  let quote = null;
  const limit = Math.min(text.length, start + 8000);
  for (let index = start; index < limit; index++) {
    const char = text[index];
    if (quote) {
      if (char === "\\") index++;
      else if (char === quote) quote = null;
    } else if (char === '"' || char === "'" || char === "`") quote = char;
    else if (char === open) depth++;
    else if (char === close && --depth === 0) return index + 1;
  }
  return limit;
}

/**
 * Offsets of the class lists in a TSX source: values of `className`-like attributes, properties
 * and variables, the arguments of class-joining calls (`cn(…)`, `clsx(…)`) whatever the
 * result is named, and the class argument of the shared role helpers (`surfaceAttributes(…)`). Bare utility names (border, shadow, truncate) are ordinary words elsewhere.
 * Ranges do not overlap, so a class is read once.
 */
export function classRanges(source) {
  const ranges = [];
  for (const match of source.matchAll(/(?<![\w$.])(?:cn|clsx|twMerge|twJoin|cva)\(/g)) {
    const open = match.index + match[0].length - 1;
    ranges.push([open + 1, balancedEnd(source, open, "(", ")")]);
  }
  // The shared role helpers take the element's class list as their second argument: the roles
  // object is data, the rest is classes, and a utility passed there is still hand-written.
  for (const match of source.matchAll(/(?<![\w$])(?<![^.]\.)\w+Attributes\(\s*/g)) {
    const open = match.index + match[0].lastIndexOf("(");
    const first = match.index + match[0].length;
    const roles = source[first] === "{" ? balancedEnd(source, first, "{", "}") : first;
    ranges.push([roles, balancedEnd(source, open, "(", ")")]);
  }
  for (const match of source.matchAll(/\b[\w$]*[cC]lass(?:Name|Names|es)?\s*[=:]\s*/g)) {
    const start = match.index + match[0].length;
    const char = source[start];
    let stop;
    if (char === '"' || char === "'" || char === "`") {
      stop = start + 1;
      while (stop < source.length && source[stop] !== char) stop += source[stop] === "\\" ? 2 : 1;
    } else if (char === "{") stop = balancedEnd(source, start, "{", "}");
    else {
      // An expression: a ternary or a call on the same statement.
      const line = source.indexOf("\n", start);
      stop = line < 0 ? source.length : line;
    }
    ranges.push([start, stop]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const range of ranges) {
    const last = merged.at(-1);
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push(range);
  }
  return merged;
}

/** Appearance findings in the class lists and inline styles of a feature TSX file. */
export function scanAppearanceTsx(source, add) {
  for (const [start, stop] of classRanges(source)) {
    const text = source.slice(start, stop);
    for (const [rule, pattern] of classRules)
      for (const match of text.matchAll(pattern)) {
        if (
          rule === "feature-motion" &&
          /^motion-reduce:animate-none$/.test(classTokenAt(source, start + match.index))
        )
          continue;
        add(rule, start + match.index);
      }
    for (const match of text.matchAll(spacingClass))
      // An arbitrary length (p-[7px]) is the narrower arbitrary-spacing rule's finding.
      if (!spacingSteps.has(match[2])) add("spacing-step", start + match.index);
  }
  for (const match of source.matchAll(/\bstyle=\{\{/g)) {
    const open = match.index + match[0].length - 1;
    const body = source
      .slice(open + 1, balancedEnd(source, open, "{", "}") - 1)
      // Nested objects, calls and strings hold values, never keys of this object.
      .replace(/(["'`])(?:\\.|(?!\1).)*\1/g, (text) => (text.includes("--") ? '"--"' : '""'))
      .replace(/\{[^{}]*\}|\([^()]*\)/g, "");
    if (/(?:^|,)\s*(?:[A-Za-z_$][\w$]*|"")\s*(?::|,|$)/.test(body))
      add("inline-style-property", match.index);
  }
}

const stateSelector = /:hover|:active|:focus|\[aria-selected/;
const controlSelector =
  /(?:^|[\s>+~,(])(?:button|input|select|textarea)(?![\w-])|\[role=["']?button/;
const spacingProperty = /^(?:gap|row-gap|column-gap|(?:padding|margin)(?:-[a-z-]+)?)$/;

/** The appearance rule a feature CSS declaration breaks, if any. */
export function appearanceRuleOfDeclaration({ property, value: raw, selectors }) {
  if (property.startsWith("--")) return null;
  // Pseudo-element ink and type belong to generated decoration, not text hierarchy.
  if (
    /^(?:font-size|font-weight|line-height|letter-spacing|color|font)$/.test(property) &&
    (selectors.at(-1) ?? "")
      .split(",")
      .every((selector) => /::(?:placeholder|before|after)\b/.test(selector))
  )
    return null;
  // Disabling motion introduces no animation or transition.
  if (/^(?:animation|transition)$/.test(property) && raw.trim() === "none") return null;
  if (selectors.some((selector) => /::-webkit-scrollbar/.test(selector))) return "scrollbar-style";
  // One finding per declaration: a state block is reported as a state, not as its contents.
  if (selectors.some((selector) => stateSelector.test(selector))) return "interaction-state";
  if (/^(?:font-size|font-weight|line-height|letter-spacing|color|font)$/.test(property))
    return "feature-typography";
  if (/^(?:text-overflow|-webkit-line-clamp|line-clamp)$/.test(property)) return "text-truncation";
  if (
    /^(?:border(?!-collapse|-spacing)|outline|background|box-shadow)/.test(property) &&
    property !== "background-clip"
  )
    return "surface-style";
  if (/^(?:transition|animation)/.test(property)) return "feature-motion";
  if (property.startsWith("scrollbar-")) return "scrollbar-style";
  if (
    /^(?:height|min-height|block-size|min-block-size)$/.test(property) &&
    controlSelector.test(selectors.at(-1) ?? "")
  )
    return "fixed-control-size";
  if (spacingProperty.test(property)) {
    // Tokens and computed values (var(--space-*), calc(), clamp()) are never compared; only the
    // bare lengths beside them are.
    const text = raw.replace(/[\w-]+\((?:[^()]|\([^()]*\))*\)/g, " ");
    if (text.split(/\s+/).some(offScale)) return "spacing-step";
  }
  return null;
}

/** Shared controls that take their size from a `size` prop, never from classes. */
export const sizedControls = new Set([
  "Button",
  "ActionHost",
  "InlineAction",
  "InlineTextAction",
  "InlineMoreAction",
  "SplitButton",
  "TextField",
  "TextareaField",
  "PasswordField",
  "NumberField",
  "SearchInput",
  "Select",
  "SearchableSelect",
  "Combobox",
  "SegmentedControl",
  "Checkbox",
  "Switch",
]);
/** Height, minimum height, square size or padding set by class on a control. */
export const controlSizeClass = tw(
  String.raw`(?:(?:h|min-h|size)-${value}|(?:p|px|py|ps|pe|pt|pb|pl|pr)-(?:\d|\[))`,
  "",
);
