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

import { Group, Row, Select } from "./settingsControls";

/** Which shell new terminals open in, and `!commands` run in. */
export function TerminalPage() {
  useLocale();
  const [listed, setListed] = useState<ShellProfiles | null>(null);
  const [scanning, setScanning] = useState(false);
  const chosen = useTerminalProfile();
  const scan = (refresh: boolean) => {
    setScanning(true);
    void listTerminalProfiles(refresh)
      .then(setListed)
      .catch(() => setListed({ profiles: [], defaultId: null }))
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
        description={t(
          "New terminals on this computer open in this shell, and local `!commands` run in it. A terminal already open keeps the shell it started with.",
        )}
        action={
          <button
            type="button"
            disabled={scanning}
            onClick={() => scan(true)}
            className="h-7 rounded-md px-2.5 text-[12px] text-content/60 hover:bg-content/10 hover:text-content disabled:opacity-50"
          >
            {scanning ? t("Looking…") : t("Look again")}
          </button>
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
          <Select
            label={t("Default terminal profile")}
            value={chosen && !missing ? chosen : ""}
            options={[
              {
                value: "",
                label: systemDefault ? `Automatic (${systemDefault.name})` : "Automatic",
              },
              ...(listed?.profiles ?? []).map((profile) => ({
                value: profile.id,
                label: profile.name,
              })),
            ]}
            onChange={(next) => saveTerminalProfile(next || undefined)}
          />
        </Row>
      </Group>
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
                <button
                  type="button"
                  onClick={() => saveTerminalProfile(profile.id)}
                  className="h-7 rounded-md bg-content/10 px-2.5 text-[12px] text-content hover:bg-content/15"
                >
                  {t("Set as default")}
                </button>
              )}
            </Row>
          ))
        )}
      </Group>
      <RemoteMachineShells />
    </>
  );
}

/** Each connected machine runs `!commands` for its sessions in its own shell. */
export function RemoteMachineShells() {
  useLocale();
  const { machines } = useRemoteMachines();
  if (machines.length === 0) return null;
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
          <span>{local ? "This computer" : "Remote server"}</span>
          <span className="break-words text-[12px] font-normal text-content/60">
            {local ? "Local sync" : machine.name}
          </span>
        </span>
      }
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
          <Select
            label={
              local
                ? t("Default shell on this computer (local sync)")
                : t("Default shell on remote server {p0}", { p0: machine.name })
            }
            value={chosen}
            options={[
              {
                value: "",
                label: systemDefault ? `Automatic (${systemDefault.name})` : "Automatic",
              },
              ...listed.profiles.map((profile) => ({
                value: profile.id,
                label: profile.name,
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
