import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { Alert } from "../../../shared/ui/Alert";
import { Button } from "../../../shared/ui/Button";
import { t, useLocale } from "../../../shared/i18n";
import { remoteRequest, useRemoteMachines } from "../../connections/model/connections";
import { HOST_UPDATE_NOTICE } from "../../connections/model/remoteCapabilities";
import { isLocalSyncMachine } from "../../connections/model/localSync";
import type { RemoteMachine } from "../../connections/model/protocol";
import {
  effectiveProfileId,
  listTerminalProfiles,
  saveTerminalProfile,
  useTerminalProfile,
  type ShellProfiles,
} from "../../terminal/model/terminalProfiles";

import { useEffect, useState } from "react";

import { AdvancedSettings, Group, Row } from "./settingsControls";

/** Which shell new terminals open in, and `!commands` run in. */
export function TerminalPage() {
  useLocale();
  const [listed, setListed] = useState<ShellProfiles | null>(null);
  const [scanning, setScanning] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const chosen = useTerminalProfile();
  const scan = (refresh: boolean) => {
    setScanning(true);
    setProblem(null);
    void listTerminalProfiles(refresh)
      .then(setListed)
      .catch((error: unknown) => {
        setProblem(String(error));
        setListed({ profiles: [], defaultId: null });
      })
      .finally(() => setScanning(false));
  };
  useEffect(() => scan(false), []);
  const systemDefault = listed?.profiles.find((profile) => profile.id === listed.defaultId);
  const missing = !!listed && !!chosen && !listed.profiles.some((profile) => profile.id === chosen);
  const current = effectiveProfileId(listed, chosen);

  return (
    <>
      <Group
        title={t("This computer · Default profile")}
        scope={t("This computer only. Remote and synced hosts have their own preferences below.")}
        persistence={{ mode: "automatic" }}
        description={t(
          "New terminals on this computer open in this shell, and local `!commands` run in it. A terminal already open keeps the shell it started with.",
        )}
        action={
          <Button
            variant="ghost"
            size="sm"
            type="button"
            disabled={scanning}
            onClick={() => scan(true)}
          >
            {scanning ? t("Looking…") : t("Look again")}
          </Button>
        }
      >
        <Row
          id="terminal-default-profile"
          label={t("Default terminal profile")}
          description={
            missing
              ? t("The shell you picked is no longer installed, so the system default is used.")
              : t(
                  "Automatic follows the system: PowerShell on Windows, your login shell elsewhere.",
                )
          }
        >
          <SearchableSelect
            label={t("Default terminal profile")}
            disabled={scanning}
            value={chosen && !missing ? chosen : ""}
            options={[
              {
                value: "",
                label: systemDefault
                  ? t("Automatic ({p0})", { p0: systemDefault.name })
                  : t("Automatic"),
              },
              ...(listed?.profiles ?? []).map((profile) => ({
                value: profile.id,
                label: profile.name,
                description: profile.path,
              })),
            ]}
            onChange={(next) => saveTerminalProfile(next || undefined)}
          />
        </Row>
      </Group>
      {problem ? (
        <Alert tone="danger" role="alert">
          {t("Could not discover shells. Use Look again to retry.")} {problem}
        </Alert>
      ) : null}
      <AdvancedSettings
        title={t("Advanced terminal settings")}
        settingIds={["terminal-default-profile", "host-shells"]}
      >
        <Group
          title={t("This computer · Available shells")}
          description={t(
            "Found on this computer. Git Bash runs bash commands such as ls, grep and && chains on Windows. Sessions on this computer use this choice even when you type the command on another machine.",
          )}
        >
          {listed === null ? (
            <Row label={t("Looking for shells…")} />
          ) : listed.profiles.length === 0 ? (
            <Row
              label={t("No shells found")}
              description={t(
                "Install PowerShell, Git for Windows or another shell, then look again.",
              )}
            />
          ) : (
            listed.profiles.map((profile) => (
              <Row key={profile.id} label={profile.name} description={profile.path}>
                {profile.id === current ? (
                  <span className="text-[12px] text-content/45">{t("Default")}</span>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    onClick={() => saveTerminalProfile(profile.id)}
                  >
                    {t("Set as default")}
                  </Button>
                )}
              </Row>
            ))
          )}
        </Group>
        <div id="setting-host-shells" data-setting-id="host-shells" tabIndex={-1}>
          <RemoteMachineShells />
        </div>
      </AdvancedSettings>
    </>
  );
}

/** Each connected machine runs `!commands` for its sessions in its own shell. */
export function RemoteMachineShells() {
  useLocale();
  const { machines } = useRemoteMachines();
  if (machines.length === 0)
    return <p>{t("Connect a machine in Connections to configure its default shell here.")}</p>;
  return (
    <>
      {machines.map((machine) => (
        <RemoteMachineShell key={machine.id} machine={machine} />
      ))}
    </>
  );
}

export function RemoteMachineShell({ machine }: { machine: RemoteMachine }) {
  useLocale();
  const local = isLocalSyncMachine(machine);
  const [listed, setListed] = useState<ShellProfiles | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const explain = (error: unknown) => {
    const text = String(error).replace(/^Error: /, "");
    return /unsupported|unknown method|not supported/i.test(text) ? HOST_UPDATE_NOTICE : text;
  };
  useEffect(() => {
    let alive = true;
    setProblem(null);
    void remoteRequest<ShellProfiles>(machine.id, "shell.profiles").then(
      (value) => {
        if (alive) setListed(value);
      },
      (error) => {
        if (alive) setProblem(explain(error));
      },
    );
    return () => {
      alive = false;
    };
  }, [machine.id]);
  const choose = (next: string) => {
    setSaving(true);
    setProblem(null);
    void remoteRequest<ShellProfiles>(
      machine.id,
      "shell.setProfile",
      { profile: next || null },
      false,
      true,
    )
      .then(setListed, (error) => setProblem(explain(error)))
      .finally(() => setSaving(false));
  };
  const systemDefault = listed?.profiles.find((profile) => profile.id === listed.defaultId);
  const chosen =
    listed?.chosenId && listed.profiles.some((profile) => profile.id === listed.chosenId)
      ? listed.chosenId
      : "";
  return (
    <Group
      title={
        <span className="flex flex-col gap-1">
          <span>{local ? t("This computer") : t("Remote server")}</span>
          <span className="break-words text-[12px] font-normal text-content/60">
            {local ? t("Local sync") : machine.name}
          </span>
        </span>
      }
      scope={t(
        "Applies to new commands on this host. Already open terminals keep their current shell.",
      )}
      persistence={{
        mode: "automatic",
        state: problem ? "error" : saving ? "saving" : "idle",
        error: problem,
      }}
      description={
        local
          ? t(
              "`!commands` in this computer's synced sessions run on this computer, using the shell selected here.",
            )
          : t(
              "`!commands` in this server's sessions run on the remote server, using the shell selected here, even when you type them on this computer.",
            )
      }
    >
      <Row
        label={t("Default shell")}
        description={
          problem ??
          (listed
            ? (listed.profiles.find((profile) => profile.id === (chosen || listed.defaultId))
                ?.path ?? undefined)
            : t("Asking the machine…"))
        }
      >
        {listed ? (
          <SearchableSelect
            disabled={saving}
            label={
              local
                ? t("Default shell on this computer (local sync)")
                : t("Default shell on remote server {p0}", { p0: machine.name })
            }
            value={chosen}
            options={[
              {
                value: "",
                label: systemDefault
                  ? t("Automatic ({p0})", { p0: systemDefault.name })
                  : t("Automatic"),
              },
              ...listed.profiles.map((profile) => ({
                value: profile.id,
                label: profile.name,
                description: profile.path,
              })),
            ]}
            onChange={(next) => {
              if (!saving) choose(next);
            }}
          />
        ) : null}
      </Row>
    </Group>
  );
}
