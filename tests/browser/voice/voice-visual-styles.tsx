import { VoiceVisualizer } from "../../../src/features/voice/ui/VoiceVisualizer";
import { VoiceLauncher } from "../../../src/features/voice/ui/companion/VoiceLauncher";
import { VoiceToolActivityPanel } from "../../../src/features/voice/ui/VoiceToolActivityPanel";
import { VoiceChatTranscript } from "../../../src/features/voice/ui/companion/VoiceChatTranscript";
import { createRoot } from "react-dom/client";
import { useState } from "react";
import { Button } from "../../../src/shared/ui/Button";
import { VoiceCompanion } from "../../../src/features/voice/ui/VoiceCompanion";
import { VoiceCompanionGate } from "../../../src/features/voice/ui/VoiceCompanionGate";
import { VoiceLauncherSlot } from "../../../src/features/voice/ui/companion/voiceLauncherSlot";
import { VoiceSettings } from "../../../src/features/voice/ui/VoiceSettings";
import {
  loadVoiceSettings,
  saveVoiceSettings,
  type VoiceVisual,
} from "../../../src/features/voice/model/voiceSettings";
import { fixtureVoice } from "./voice-visual-styles-mocks";
import { setLanguagePreference } from "../../../src/shared/i18n";
import { noteDisplayRefreshRate } from "../../../src/features/settings/model/decorativeMotion";
import type { Session } from "../../../src/features/sessions/model/session";
import { registerVoiceDraftReader } from "../../../src/features/voice/model/voiceDraftContext";
import { VoiceSetupSteps } from "../../../src/features/voice/ui/VoiceSetupSteps";
import { saveKeybindingOverride } from "../../../src/features/settings/model/settings";
import "../../../src/styles/index.css";
const params = new URLSearchParams(location.search);
const wakeQuickSettings = params.has("wake-quick-settings");
if (params.has("high-refresh")) noteDisplayRefreshRate(240);
if (params.has("push-to-talk"))
  saveKeybindingOverride("Voice: Push to Talk", { shortcut: "Control+Shift+KeyQ" });
document.documentElement.classList.toggle("theme-light", params.get("theme") === "light");
await setLanguagePreference(params.get("lang") === "tr" ? "tr" : "en");
saveVoiceSettings({
  ...loadVoiceSettings(),
  enabled: true,
  visual: (params.get("visual") || "mark") as VoiceVisual,
  compact: false,
});
// Persona setup appears on first launch; scenarios opt in with ?first-run.
if (params.has("first-run")) localStorage.removeItem("bycoda.voice.persona");
else if (!localStorage.getItem("bycoda.voice.persona"))
  localStorage.setItem("bycoda.voice.persona", JSON.stringify({ status: "skipped" }));
const session = {
  id: "fixture",
  title: "Voice visual styles · a long session title to verify truncation",
  cwd: params.has("remote") ? "remote://paired/repo" : "/fixture",
  blocks: [],
  harness: "codex",
  model: "fixture-model",
  busy: params.get("state") === "working" || params.has("working"),
} as unknown as Session;
const navigation = params.has("navigation");
const global = params.has("global") || navigation;
if (params.has("control"))
  fixtureVoice.jobs.push({
    id: "control-job",
    title: "Recovery",
    projectId: "fixture-project",
    version: 1,
    status: "running",
  });
if (params.has("fresh-scope")) localStorage.removeItem("bycoda.voice.scope");
else
  localStorage.setItem(
    "bycoda.voice.scope",
    params.get("scope") === "project" ? "project" : global ? "global" : "project",
  );
if (global)
  registerVoiceDraftReader(session.id, () => ({
    text: "Please review this unsent request before I send it.",
    attachments: [
      {
        id: "fixture-text",
        name: "review.txt",
        kind: "file",
        mimeType: "text/plain",
        size: 26,
        data: btoa("Unsent attachment contents"),
      },
    ],
  }));
const workspace = global
  ? {
      tools: [
        {
          name: "workspace.projects.list",
          description: "List fixture projects.",
          parameters: { type: "object", properties: {} },
        },
      ],
      execute: async (action: string) => {
        fixtureVoice.actions.push(action);
        if (params.has("pending-tool"))
          return new Promise((resolve) => {
            fixtureVoice.finishTool = resolve;
          });
        return { status: "completed", projects: [{ path: session.cwd, name: "Fixture project" }] };
      },
    }
  : undefined;
function FixtureCompanion() {
  const [next, setNext] = useState(false);
  const second = {
    ...session,
    id: "fixture-next",
    title: "Second fixture project",
    cwd: "/fixture-next",
  };
  const current = next ? second : session;
  const Companion = wakeQuickSettings ? VoiceCompanionGate : VoiceCompanion;
  return (
    <main style={{ padding: 24, maxInlineSize: 720 }}>
      <p>Fixture evidence · synthetic audio and session state</p>
      {params.get("wake-quick-settings") !== "error" && <VoiceSettings />}
      {navigation && (
        <Button onClick={() => setNext((value) => !value)}>Switch fixture project</Button>
      )}
      {wakeQuickSettings && (
        <footer
          style={{
            position: "fixed",
            insetBlockEnd: 8,
            insetInlineStart: 8,
            display: "flex",
            justifyContent: "center",
            inlineSize: params.has("compact-rail") ? 56 : undefined,
          }}
        >
          <VoiceLauncherSlot compact={params.has("compact-rail")} />
        </footer>
      )}
      <Companion
        activeId={params.has("no-active") ? undefined : current.id}
        sessions={navigation ? [session, second] : [session]}
        onSubmit={() => {
          fixtureVoice.submits++;
          return false;
        }}
        onStop={() => {
          fixtureVoice.stops++;
        }}
        workspace={workspace}
        projects={
          global
            ? [
                { path: session.cwd, name: "Fixture project" },
                ...(navigation ? [{ path: second.cwd, name: second.title }] : []),
              ]
            : undefined
        }
        projectPath={global ? current.cwd : undefined}
        assistantSession={
          global
            ? navigation
              ? { ...current, id: `assistant-${current.id}` }
              : current
            : undefined
        }
      />
    </main>
  );
}
createRoot(document.getElementById("root")!).render(
  params.has("working-probe") ? (
    <VoiceVisualizer visual={loadVoiceSettings().visual} state="listening" working />
  ) : params.has("launcher-dot") ? (
    <VoiceLauncher
      ref={null}
      visual="mark"
      name="Arif"
      avatar={undefined}
      state="connecting"
      onOpen={() => {}}
    />
  ) : params.has("activity-probe") ? (
    <main>
      <VoiceToolActivityPanel
        entries={[
          {
            id: "fixture",
            name: "Search",
            target: "project",
            projectPath: "/fixture",
            startedAt: Date.now(),
            state: "running",
          },
          ...(params.has("activity-states")
            ? (
                [
                  {
                    id: "unknown",
                    name: "desktop.windows.list",
                    state: "uncertain",
                    elapsedMs: 1000,
                  },
                  { id: "done", name: "app_tools_list", state: "returned", elapsedMs: 0 },
                  { id: "choices", name: "present_choices", state: "returned", elapsedMs: 81000 },
                  {
                    id: "waiting",
                    name: "workspace.sessions.update",
                    state: "waiting-owner",
                    elapsedMs: 2000,
                  },
                  { id: "failed", name: "desktop.windows.focus", state: "failed", elapsedMs: 3000 },
                  {
                    id: "long",
                    name: "workspace.sessions.anextremelylongunbrokentoolidentifierthatmustwrapwithoutoverlappingduration",
                    state: "returned",
                    elapsedMs: 3000,
                  },
                ] as const
              ).map((entry) => ({
                ...entry,
                target: "project",
                projectPath: "/fixture",
                startedAt: 0,
                requestId: `request-${entry.id}`,
              }))
            : []),
        ]}
        onStopWaiting={() => {}}
      />
    </main>
  ) : params.has("transcript-fixture") ? (
    <main style={{ padding: 24, maxInlineSize: 560 }}>
      <VoiceChatTranscript
        turns={[
          { id: 1, role: "owner", text: "Please review this draft." },
          { id: 2, role: "assistant", text: "I will review it." },
        ]}
      />
    </main>
  ) : params.has("setup-step") ? (
    <main style={{ padding: 24, maxInlineSize: 560 }}>
      <p>Fixture evidence · actual setup controls, no microphone/provider acceptance</p>
      <h1>Assistant Arif · {params.get("setup-step")}</h1>
      <VoiceSetupSteps
        step={params.get("setup-step") as "provider" | "voice" | "microphone"}
        language="tr-TR"
        name="Arif"
        onValidChange={() => {}}
      />
    </main>
  ) : (
    <FixtureCompanion />
  ),
);
Object.assign(window, { fixtureVoice });
