import { errorText } from "../../../shared/lib/errors";
import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { isTauri } from "@tauri-apps/api/core";
import { hostToolRequest } from "../../connections/public/hostFeatureClient";
import { toolPreferences } from "../../host-tools/public/toolPreferences";
import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { useConfirm } from "../../../shared/ui/ConfirmDialog";
import { Group, Row, Select, SettingsFeedback, Toggle } from "../../../shared/ui/settings";
import { preparedFileSize, readTextFile } from "../../../platform/tauri/fs";
import { BrowserProfileImportDialog, type BrowserImportSource } from "./BrowserProfileImportDialog";

type State = {
  agentAccess: boolean;
  claudeChrome: boolean;
  autoShow: boolean;
  recordingFps: number;
  liveFps?: number;
  defaultProfileId: string | null;
  developmentProfileId?: string | null;
  profiles: { id: string; name: string; agents: boolean }[];
};

/** Mirrors the Host's initial browser settings (`host/browser/browser-profiles.ts`). */
const BROWSER_PREFERENCE_DEFAULTS = {
  autoShow: true,
  liveFps: 60,
  recordingFps: 4,
} as const;

type Sources = {
  defaultBrowser: { browser: string; name: string } | null;
  sources: BrowserImportSource[];
};

function requestProfiles<T = State>(
  method: "list" | "sources" | "update",
  params: Record<string, unknown> = {},
) {
  return hostToolRequest<T>("", "browser.profiles.v1", `browser.profiles.${method}`, params, {
    kind: "local",
  });
}

export function BrowserProfileSettings() {
  useLocale();
  const [state, setState] = useState<State>();
  const [sources, setSources] = useState<Sources>();
  const [sourcesError, setSourcesError] = useState<string>();
  const [choosing, setChoosing] = useState(false);
  const [importing, setImporting] = useState(false);
  const { confirm, dialog } = useConfirm();
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);

  /** Detects installed browsers; a failure is kept so the import dialog never reads it as "none found". */
  const loadSources = async (isCurrent: () => boolean = () => true) => {
    setSourcesError(undefined);
    try {
      const result = await requestProfiles<Sources>("sources");
      if (isCurrent()) setSources(result);
    } catch (error) {
      if (isCurrent()) setSourcesError(errorText(error));
    }
  };

  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Loads profile names and grants from this desktop's Host while this settings section is mounted; retry re-runs it.
  useEffect(() => {
    if (!isTauri()) return;
    let current = true;
    void requestProfiles("list")
      .then((result) => {
        if (current) setState(result);
      })
      .catch(() => {
        if (current) setProblem(t("Could not load browser profiles."));
      });
    void loadSources(() => current);
    return () => {
      current = false;
    };
  }, [retry]);

  if (!isTauri()) return null;

  const update = async (action: string, value: unknown) => {
    const updated = await requestProfiles("update", { action, value });
    setState(updated);
    toolPreferences.browserDevelopmentUsesImportedProfile.save(
      updated.developmentProfileId != null,
    );
  };
  /** `problem` is the translated sentence shown when the operation fails. */
  const run = (operation: () => Promise<unknown>, problem: string) => {
    setBusy(true);
    setProblem("");
    void operation()
      .catch(() => setProblem(problem))
      .finally(() => setBusy(false));
  };
  const importFile = () =>
    run(async () => {
      const file = await open({
        multiple: false,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (typeof file !== "string") return;
      const size = await preparedFileSize(file);
      if (size === undefined || size > 256 * 1024)
        throw new Error("Browser profile file exceeds its limit.");
      const name =
        file
          .split(/[\\/]/)
          .pop()
          ?.replace(/\.json$/i, "")
          .trim() ?? "";
      await update("import", { name, json: await readTextFile(file) });
    }, t("Could not import the profile. Choose a Playwright state JSON file up to 256 KB with a unique filename."));
  const importFromBrowser = ({ id, browserName }: BrowserImportSource) => {
    setChoosing(false);
    setImporting(true);
    setBusy(true);
    setProblem("");
    void update("importBrowser", { sourceId: id })
      .catch((error: unknown) => {
        // The Host's refusal is one fixed English sentence per cause; show the matching translation.
        const appBound = error instanceof Error && error.message.includes("app-bound");
        setProblem(
          appBound
            ? t("{p0} protects its cookies in a way that cannot be imported automatically.", {
                p0: browserName,
              })
            : t("Could not import {p0}. If it is open, close it completely and try again.", {
                p0: browserName,
              }),
        );
      })
      .finally(() => {
        setBusy(false);
        setImporting(false);
      });
  };
  const save = (action: string, value: unknown) =>
    run(() => update(action, value), t("Could not save browser profile settings."));

  const profileOptions = [
    { value: "isolated", label: t("Isolated") },
    ...(state?.profiles ?? []).map(({ id, name }) => ({ value: id, label: name })),
  ];

  return (
    <>
      <Group
        title={t("Browser profiles")}
        layout="full"
        feedback={
          problem ? (
            <SettingsFeedback
              state="error"
              action={
                state
                  ? undefined
                  : {
                      label: t("Retry"),
                      onClick: () => {
                        setProblem("");
                        setRetry((value) => value + 1);
                      },
                    }
              }
            >
              {problem}
            </SettingsFeedback>
          ) : !state ? (
            <SettingsFeedback state="loading">{t("Loading browser profiles…")}</SettingsFeedback>
          ) : importing ? (
            <SettingsFeedback state="loading">{t("Importing browser profile…")}</SettingsFeedback>
          ) : undefined
        }
      >
        {state && (
          <>
            <Row
              id="browser-default-profile"
              label={t("Default browser profile")}
              description={t("For regular websites.")}
              descriptionVisible
            >
              <Select
                label={t("Default browser profile")}
                hideLabel
                value={state.defaultProfileId ?? "isolated"}
                disabled={busy}
                options={profileOptions}
                onChange={(value) => save("default", value === "isolated" ? null : value)}
              />
            </Row>
            <Row
              id="browser-development-profile"
              label={t("Development browser profile")}
              description={t("For localhost and loopback addresses.")}
              descriptionVisible
            >
              <Select
                label={t("Development browser profile")}
                hideLabel
                value={state.developmentProfileId ?? "isolated"}
                disabled={busy}
                options={profileOptions}
                onChange={(value) => save("development", value === "isolated" ? null : value)}
              />
            </Row>
            {state.profiles.map((profile) => (
              <Row
                key={profile.id}
                label={profile.name}
                description={t("Control whether agents can use this profile.")}
              >
                <Toggle
                  label={t("Allow agents to use {p0}", { p0: profile.name })}
                  on={profile.agents}
                  disabled={busy || !state.agentAccess}
                  onChange={(agents) => save("grant", { id: profile.id, agents })}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  label={t("Remove profile {p0}", { p0: profile.name })}
                  onClick={() => {
                    void confirm({
                      title: t("Remove browser profile"),
                      message: t("Remove the imported browser state for {p0}?", {
                        p0: profile.name,
                      }),
                      confirmLabel: t("Remove"),
                      tone: "danger",
                      onConfirm: () => update("remove", profile.id),
                    }).catch(() => setProblem(t("Could not save browser profile settings.")));
                  }}
                >
                  {t("Remove")}
                </Button>
              </Row>
            ))}
            <Row
              id="browser-profile-import"
              label={t("Import browser profile")}
              description={
                sources?.defaultBrowser
                  ? t("Default browser: {p0}", {
                      p0: sources.defaultBrowser.name,
                    })
                  : t("Reuse sign-ins from a browser on this computer in an isolated profile.")
              }
              descriptionVisible
            >
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  setChoosing(true);
                  // Detect again on open: a browser installed or signed in since load must appear.
                  void loadSources();
                }}
              >
                {t("Import")}
              </Button>
            </Row>
          </>
        )}
        {dialog}
        {choosing && (
          <BrowserProfileImportDialog
            sources={sources?.sources}
            error={sourcesError}
            onRetry={() => void loadSources()}
            onImport={importFromBrowser}
            onFile={() => {
              setChoosing(false);
              importFile();
            }}
            onClose={() => setChoosing(false)}
          />
        )}
      </Group>
      {state && (
        <Group title={t("Browser behavior")} layout="full">
          <Row id="browser-agent-access" label={t("Agent browser access")}>
            <Toggle
              label={t("Agent browser access")}
              on={state.agentAccess}
              disabled={busy}
              onChange={(value) => save("agentAccess", value)}
            />
          </Row>
          <Row
            id="browser-claude-chrome"
            label={t("Claude in Chrome")}
            description={t(
              "Allow new local Claude sessions to connect through the Chrome extension. Choose the Chrome profile and site access in Claude.",
            )}
          >
            <Toggle
              label={t("Claude in Chrome")}
              on={state.claudeChrome}
              disabled={busy || !state.agentAccess}
              onChange={(value) => save("claudeChrome", value)}
            />
          </Row>
          <Row
            id="browser-auto-show"
            label={t("Auto-show browser preview")}
            description={t(
              "Show the Browser panel when an agent opens a preview, unless requested otherwise.",
            )}
            modified={!busy && state.autoShow !== BROWSER_PREFERENCE_DEFAULTS.autoShow}
            onReset={() => save("autoShow", BROWSER_PREFERENCE_DEFAULTS.autoShow)}
          >
            <Toggle
              label={t("Auto-show browser preview")}
              on={state.autoShow}
              disabled={busy}
              onChange={(value) => save("autoShow", value)}
            />
          </Row>
          <Row
            id="browser-live-fps"
            label={t("Browser panel frame rate")}
            description={t("How smoothly the live Browser panel updates. Lower uses less CPU.")}
            modified={
              !busy &&
              (state.liveFps ?? BROWSER_PREFERENCE_DEFAULTS.liveFps) !==
                BROWSER_PREFERENCE_DEFAULTS.liveFps
            }
            onReset={() => save("liveFps", BROWSER_PREFERENCE_DEFAULTS.liveFps)}
          >
            <Select
              label={t("Browser panel frame rate")}
              hideLabel
              value={String(state.liveFps ?? BROWSER_PREFERENCE_DEFAULTS.liveFps)}
              disabled={busy}
              options={[10, 15, 30, 60].map((fps) => ({
                value: String(fps),
                label: t("{p0} fps", { p0: fps }),
              }))}
              onChange={(value) => save("liveFps", Number(value))}
            />
          </Row>
          <Row
            id="browser-recording-fps"
            label={t("Browser recording frame rate")}
            description={t("Frame rate of browser videos that agents record.")}
            modified={!busy && state.recordingFps !== BROWSER_PREFERENCE_DEFAULTS.recordingFps}
            onReset={() => save("recordingFps", BROWSER_PREFERENCE_DEFAULTS.recordingFps)}
          >
            <Select
              label={t("Browser recording frame rate")}
              hideLabel
              value={String(state.recordingFps)}
              disabled={busy}
              options={[4, 8, 10, 15, 30, 60].map((fps) => ({
                value: String(fps),
                label: t("{p0} fps", { p0: fps }),
              }))}
              onChange={(value) => save("recordingFps", Number(value))}
            />
          </Row>
        </Group>
      )}
    </>
  );
}
