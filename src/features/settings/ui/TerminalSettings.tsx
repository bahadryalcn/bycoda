import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { Button } from "../../../shared/ui/Button";
import { Badge } from "../../../shared/ui/Badge";
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

import { useEffect, useRef, useState } from "react";

import { AdvancedSettings, Group, Row, SettingsFeedback } from "./settingsControls";
import "./TerminalSettings.css";

/** Which shell new terminals open in, and `!commands` run in. */
export function TerminalPage() {
  useLocale();
  const [listed, setListed] = useState<ShellProfiles | null>(null);
  const [scanning, setScanning] = useState(true);
  const [problem, setProblem] = useState<string | null>(null);
  const request = useRef(0);
  const chosen = useTerminalProfile();
  const readProfiles = (refresh: boolean, generation: number) => {
    void listTerminalProfiles(refresh)
      .then((value) => {
        if (generation === request.current) setListed(value);
      })
      .catch((error: unknown) => {
        if (generation === request.current) setProblem(String(error));
      })
      .finally(() => {
        if (generation === request.current) setScanning(false);
      });
  };
  const scan = (refresh: boolean) => {
    const generation = ++request.current;
    setScanning(true);
    setProblem(null);
    readProfiles(refresh, generation);
  };
  useEffect(() => {
    readProfiles(false, ++request.current);
    return () => {
      request.current++;
    };
  }, []);
  const systemDefault = listed?.profiles.find((profile) => profile.id === listed.defaultId);
  const missing = !!listed && !!chosen && !listed.profiles.some((profile) => profile.id === chosen);
  const current = effectiveProfileId(listed, chosen);

  return (
    <div className="terminal-settings">
      <Group
        layout="full"
        title={t("This computer")}
        persistence={{ mode: "automatic" }}
        description={t("Choose the shell for new terminals and local !commands.")}
        feedback={
          problem ? (
            <SettingsFeedback state="error">
              {t("Could not discover shells. Use Look again to retry.")} {problem}
            </SettingsFeedback>
          ) : scanning ? (
            <SettingsFeedback state="loading">{t("Looking for shells…")}</SettingsFeedback>
          ) : null
        }
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
              : undefined
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
      <Group
        id="host-shells"
        layout="full"
        title={t("Synced sessions and remote hosts")}
        description={t("Each machine uses its own shell, wherever you send the command from.")}
        persistence={{ mode: "automatic" }}
      >
        <RemoteMachineShells />
      </Group>
      <p className="terminal-settings-note">
        {t(
          "Applies to new commands on this host. Already open terminals keep their current shell.",
        )}
      </p>
      <AdvancedSettings title={t("Advanced terminal settings")}>
        <Group
          layout="full"
          title={t("This computer · Available shells")}
          description={t(
            "Found on this computer. Git Bash runs bash commands such as ls, grep and && chains on Windows. Sessions on this computer use this choice even when you type the command on another machine.",
          )}
        >
          {scanning ? (
            <SettingsFeedback state="loading">{t("Looking for shells…")}</SettingsFeedback>
          ) : problem ? (
            <Row label={t("Not checked yet")} />
          ) : !listed?.profiles.length ? (
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
                  <Badge>{t("Default")}</Badge>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    disabled={scanning}
                    onClick={() => saveTerminalProfile(profile.id)}
                  >
                    {t("Set as default")}
                  </Button>
                )}
              </Row>
            ))
          )}
        </Group>
        <Group layout="full" title={t("How it works")}>
          <Row
            label={t("This computer")}
            description={t(
              "New terminals on this computer open in this shell, and local `!commands` run in it. A terminal already open keeps the shell it started with.",
            )}
          />
          <Row
            label={t("Automatic")}
            description={t(
              "Automatic follows the system: PowerShell on Windows, your login shell elsewhere.",
            )}
          />
          <Row
            label={t("Local sync")}
            description={t(
              "`!commands` in this computer's synced sessions run on this computer, using the shell selected here.",
            )}
          />
          <Row
            label={t("Remote server")}
            description={t(
              "`!commands` in this server's sessions run on the remote server, using the shell selected here, even when you type them on this computer.",
            )}
          />
        </Group>
      </AdvancedSettings>
    </div>
  );
}

/** Each connected machine runs `!commands` for its sessions in its own shell. */
export function RemoteMachineShells() {
  useLocale();
  const { machines } = useRemoteMachines();
  if (machines.length === 0)
    return (
      <Row label={t("Connect a machine in Connections to configure its default shell here.")} />
    );
  return (
    <>
      {machines.map((machine) => (
        <RemoteMachineShell key={machine.id} machine={machine} />
      ))}
    </>
  );
}

export function RemoteMachineShell({ machine }: { machine: RemoteMachine }) {
  return <RemoteMachineShellState key={machine.id} machine={machine} />;
}

function RemoteMachineShellState({ machine }: { machine: RemoteMachine }) {
  useLocale();
  const local = isLocalSyncMachine(machine);
  const [listed, setListed] = useState<ShellProfiles | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  const generation = useRef(0);
  const [retry, setRetry] = useState(0);
  const explain = (error: unknown) => {
    const text = String(error).replace(/^Error: /, "");
    return /unsupported|unknown method|not supported/i.test(text) ? HOST_UPDATE_NOTICE : text;
  };
  useEffect(() => {
    let alive = true;
    generation.current++;
    void remoteRequest<ShellProfiles>(machine.id, "shell.profiles")
      .then(
        (value) => {
          if (alive) setListed(value);
        },
        (error) => {
          if (alive) setProblem(explain(error));
        },
      )
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
      generation.current++;
    };
  }, [machine.id, retry]);
  const choose = (next: string) => {
    if (saving || loading) return;
    const version = generation.current;
    setSaving(true);
    setSaved(false);
    setProblem(null);
    void remoteRequest<ShellProfiles>(
      machine.id,
      "shell.setProfile",
      { profile: next || null },
      false,
      true,
    )
      .then(
        (value) => {
          if (version !== generation.current) return;
          setListed(value);
          setSaved(true);
        },
        (error) => {
          if (version === generation.current) setProblem(explain(error));
        },
      )
      .finally(() => {
        if (version === generation.current) setSaving(false);
      });
  };
  const systemDefault = listed?.profiles.find((profile) => profile.id === listed.defaultId);
  const chosen =
    listed?.chosenId && listed.profiles.some((profile) => profile.id === listed.chosenId)
      ? listed.chosenId
      : "";
  return (
    <Row
      feedback={
        problem ? (
          <SettingsFeedback
            state="error"
            action={
              !listed ? (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setListed(null);
                    setLoading(true);
                    setSaved(false);
                    setProblem(null);
                    setRetry((value) => value + 1);
                  }}
                >
                  {t("Retry")}
                </Button>
              ) : undefined
            }
          >
            {problem}
          </SettingsFeedback>
        ) : loading || saving || saved ? (
          <SettingsFeedback state={saved ? "success" : "loading"}>
            {saving ? t("Saving…") : loading ? t("Asking the machine…") : t("Saved")}
          </SettingsFeedback>
        ) : null
      }
      label={
        <span className="terminal-settings-machine">
          <span>{local ? t("This computer") : machine.name}</span>
          <Badge>{local ? t("Local sync") : t("Remote server")}</Badge>
        </span>
      }
      description={
        listed
          ? (listed.profiles.find((profile) => profile.id === (chosen || listed.defaultId))?.path ??
            undefined)
          : undefined
      }
    >
      {listed ? (
        <SearchableSelect
          disabled={saving || loading}
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
  );
}
