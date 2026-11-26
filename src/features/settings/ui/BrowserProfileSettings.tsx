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

type State = {
  agentAccess: boolean;
  claudeChrome: boolean;
  autoShow: boolean;
  recordingFps: number;
  defaultProfileId: string | null;
  developmentProfileId?: string | null;
  profiles: { id: string; name: string; agents: boolean }[];
};

function requestProfiles(method: "list" | "update", params: Record<string, unknown> = {}) {
  return hostToolRequest<State>("", "browser.profiles.v1", `browser.profiles.${method}`, params, {
    kind: "local",
  });
}

export function BrowserProfileSettings() {
  useLocale();
  const [state, setState] = useState<State>();
  const { confirm, dialog } = useConfirm();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);

  // oxlint-disable-next-line bycoda/effect-names-its-sync -- loads profile names and grants from this desktop's Host while the section is mounted
  useEffect(() => {
    if (!isTauri()) return;
    let current = true;
    void requestProfiles("list")
      .then((result) => {
        if (current) setState(result);
      })
      .catch(() => {
        if (current) setError(t("Could not load browser profiles."));
      });
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
  const run = (operation: () => Promise<unknown>, failure: string) => {
    setBusy(true);
    setError("");
    void operation()
      .catch(() => setError(failure))
      .finally(() => setBusy(false));
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
          error ? (
            <SettingsFeedback
              state="error"
              action={
                state
                  ? undefined
                  : {
                      label: t("Retry"),
                      onClick: () => {
                        setError("");
                        setRetry((value) => value + 1);
                      },
                    }
              }
            >
              {error}
            </SettingsFeedback>
          ) : !state ? (
            <SettingsFeedback state="loading">{t("Loading browser profiles…")}</SettingsFeedback>
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
                    }).catch(() => setError(t("Could not save browser profile settings.")));
                  }}
                >
                  {t("Remove")}
                </Button>
              </Row>
            ))}
            <Row
              id="browser-profile-import"
              label={t("Import browser profile")}
              description={t(
                "Import Playwright browser state to reuse sign-ins in an isolated profile on this computer.",
              )}
            >
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() =>
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
                  }, t("Could not import the profile. Choose a Playwright state JSON file up to 256 KB with a unique filename."))
                }
              >
                {t("Import")}
              </Button>
            </Row>
          </>
        )}
        {dialog}
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
          >
            <Toggle
              label={t("Auto-show browser preview")}
              on={state.autoShow}
              disabled={busy}
              onChange={(value) => save("autoShow", value)}
            />
          </Row>
          <Row id="browser-recording-fps" label={t("Browser recording frame rate")}>
            <Select
              label={t("Browser recording frame rate")}
              hideLabel
              value={String(state.recordingFps)}
              disabled={busy}
              options={[...new Set([4, 8, 10, state.recordingFps])]
                .sort((left, right) => left - right)
                .map((fps) => ({
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
