import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Button } from "../../../shared/ui/Button";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { t, useLocale } from "../../../shared/i18n";
import { remoteRequest, useRemoteMachines } from "../../connections/public/connections";
import { HOST_UPDATE_NOTICE } from "../../connections/public/remoteCapabilities";
import { isLocalSyncMachine } from "../../connections/public/localSync";
import type { RemoteMachine } from "../../connections";
import {
  effectiveProfileId,
  listTerminalProfiles,
  saveTerminalProfile,
  syncTerminalProfileMirror,
  useTerminalProfile,
  type ShellProfiles,
} from "../../terminal/model/terminalProfiles";

import { useEffect, useRef, useState } from "react";

import { Group, SettingsFeedback } from "./settingsControls";
import { HostShellRow, shellCount } from "./HostShellRow";
import "./SettingsCollection.css";
import "./TerminalSettings.css";

/** Which shell new terminals open in, and `!commands` run in, per machine. */
export function TerminalPage() {
  useLocale();
  const [listed, setListed] = useState<ShellProfiles | null>(null);
  const [scanning, setScanning] = useState(true);
  const [problem, setProblem] = useState<string | null>(null);
  const [saveProblem, setSaveProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  /** A saved choice this window could not copy into its own cache (TS-03). */
  const [unmirrored, setUnmirrored] = useState<{ id: string | undefined } | null>(null);
  const savingRef = useRef(false);
  const chooseProfile = async (id: string | undefined) => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setSaveProblem(null);
    setUnmirrored(null);
    try {
      const result = await saveTerminalProfile(id);
      if (!result.mirrored) setUnmirrored({ id });
    } catch (error) {
      setSaveProblem(error instanceof Error ? error.message : String(error));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };
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
  const missing = !!listed && !!chosen && !listed.profiles.some((profile) => profile.id === chosen);
  const current = effectiveProfileId(listed, chosen);

  return (
    <div className="terminal-settings settings-topics">
      <Group
        id="host-shells"
        title={t("Default shell by machine")}
        description={t("Each machine uses its own shell, wherever you send the command from.")}
        descriptionVisible
        persistence={{ mode: "automatic" }}
        info={
          <InfoPopover className="shrink-0" label={t("How it works")} width={360}>
            <p>
              {t(
                "New terminals on this computer open in this shell, and local `!commands` run in it. A terminal already open keeps the shell it started with.",
              )}
            </p>
            <p>
              {t(
                "Automatic follows the system: PowerShell on Windows, your login shell elsewhere.",
              )}
            </p>
            <p>
              {t(
                "`!commands` in this computer's synced sessions run on this computer, using the shell selected here.",
              )}
            </p>
            <p>
              {t(
                "`!commands` in this server's sessions run on the remote server, using the shell selected here, even when you type them on this computer.",
              )}
            </p>
            <p>
              {t(
                "Applies to new commands on this host. Already open terminals keep their current shell.",
              )}
            </p>
          </InfoPopover>
        }
      >
        <div
          {...surfaceAttributes(
            { variant: "card", frame: "none", radius: "none" },
            "settings-collection terminal-host-list",
          )}
        >
          <HostShellRow
            settingId="terminal-default-profile"
            detailId="terminal-available-shells"
            name={t("This computer")}
            kind="local"
            status={
              problem
                ? { tone: "danger", label: t("Unavailable") }
                : scanning
                  ? { tone: "info", label: t("Looking for shells…") }
                  : listed
                    ? {
                        tone: listed.profiles.length > 0 ? "success" : "warning",
                        label: shellCount(listed.profiles.length),
                      }
                    : { tone: "neutral", label: t("Not checked yet") }
            }
            listed={listed}
            chosen={chosen ?? ""}
            effectiveId={current}
            missing={missing}
            loading={scanning}
            disabled={saving}
            refreshDisabled={saving}
            selectLabel={t("Default terminal profile")}
            refreshLabel={t("Look again")}
            onChoose={(next) => void chooseProfile(next || undefined)}
            onRefresh={() => scan(true)}
            feedback={
              saveProblem ? (
                <SettingsFeedback state="error">
                  {t("Could not save the terminal profile. Select it again to retry.")}{" "}
                  {saveProblem}
                </SettingsFeedback>
              ) : unmirrored && !saving ? (
                <SettingsFeedback
                  state="warning"
                  action={
                    <Button
                      variant="ghost"
                      onClick={() => {
                        if (syncTerminalProfileMirror(unmirrored.id)) setUnmirrored(null);
                      }}
                    >
                      {t("Retry")}
                    </Button>
                  }
                >
                  {t(
                    "The shell was saved on this computer, but this window could not remember it, so it may still show the previous choice. Retry updates only this window; the saved shell is not written again.",
                  )}
                </SettingsFeedback>
              ) : saving ? (
                <SettingsFeedback state="loading" immediate>
                  {t("Saving…")}
                </SettingsFeedback>
              ) : problem ? (
                <SettingsFeedback state="error">
                  {t("Could not discover shells. Use Look again to retry.")} {problem}
                </SettingsFeedback>
              ) : scanning && !listed ? (
                <SettingsFeedback state="loading">{t("Looking for shells…")}</SettingsFeedback>
              ) : null
            }
          />
          <RemoteMachineShells />
        </div>
      </Group>
    </div>
  );
}

/** Each connected machine runs `!commands` for its sessions in its own shell. */
export function RemoteMachineShells() {
  useLocale();
  const { machines, loaded, loading, error, refresh } = useRemoteMachines();
  const remoteMachines = machines.filter((machine) => !isLocalSyncMachine(machine));
  return (
    <>
      {error ? (
        <div className="terminal-host-notice">
          <SettingsFeedback
            state="error"
            action={
              <Button loading={loading} onClick={refresh}>
                {t("Retry")}
              </Button>
            }
          >
            {error}
          </SettingsFeedback>
        </div>
      ) : null}
      {!loaded && loading ? (
        <div className="terminal-host-notice">
          <SettingsFeedback state="loading">{t("Loading…")}</SettingsFeedback>
        </div>
      ) : null}
      {loaded && !loading && !error && remoteMachines.length === 0 ? (
        <EmptyState
          size="inline"
          className="settings-collection-empty"
          descriptionText={{ size: "caption", tone: "secondary", leading: "normal" }}
          description={t("Connect a machine in Connections to configure its default shell here.")}
        />
      ) : null}
      {remoteMachines.map((machine) => (
        <RemoteMachineShell key={machine.id} machine={machine} />
      ))}
    </>
  );
}

export function RemoteMachineShell({ machine }: { machine: RemoteMachine }) {
  return (
    <RemoteMachineShellState
      key={JSON.stringify([machine.id, machine.environmentId, machine.endpoint, machine.ssh])}
      machine={machine}
    />
  );
}

function RemoteMachineShellState({ machine }: { machine: RemoteMachine }) {
  useLocale();
  const local = isLocalSyncMachine(machine);
  const [listed, setListed] = useState<ShellProfiles | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  const [needsRead, setNeedsRead] = useState(false);
  const [requestedShell, setRequestedShell] = useState<string | null>(null);
  const savingRef = useRef(false);
  const generation = useRef(0);
  const [retry, setRetry] = useState(0);
  const explain = (error: unknown) => {
    const text = String(error).replace(/^Error: /, "");
    return /unsupported|unknown method|not supported/i.test(text) ? HOST_UPDATE_NOTICE : text;
  };
  useEffect(() => {
    let alive = true;
    generation.current++;
    setLoading(true);
    setProblem(null);
    setSaved(false);
    void remoteRequest<ShellProfiles>(machine.id, "shell.profiles")
      .then(
        (value) => {
          if (alive) {
            setListed(value);
            setNeedsRead(false);
            setRequestedShell(null);
          }
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
    if (savingRef.current || loading || needsRead) return;
    savingRef.current = true;
    setRequestedShell(next);
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
          if (version === generation.current) {
            setProblem(explain(error));
            setNeedsRead(true);
          }
        },
      )
      .finally(() => {
        if (version === generation.current) {
          savingRef.current = false;
          setSaving(false);
        }
      });
  };
  const chosen =
    listed?.chosenId && listed.profiles.some((profile) => profile.id === listed.chosenId)
      ? listed.chosenId
      : "";
  const missing =
    !!listed?.chosenId && !listed.profiles.some((profile) => profile.id === listed.chosenId);
  const reread = () => {
    setLoading(true);
    setSaved(false);
    setProblem(null);
    setRetry((value) => value + 1);
  };
  return (
    <HostShellRow
      name={machine.name}
      kind={local ? "synced" : "remote"}
      status={
        problem
          ? { tone: "danger", label: t("Unavailable") }
          : loading
            ? { tone: "info", label: t("Asking the machine…") }
            : listed
              ? {
                  tone: listed.profiles.length > 0 ? "success" : "warning",
                  label: shellCount(listed.profiles.length),
                }
              : { tone: "neutral", label: t("Not checked yet") }
      }
      listed={listed}
      chosen={chosen}
      effectiveId={listed ? chosen || (listed.defaultId ?? undefined) : undefined}
      missing={missing}
      loading={loading}
      disabled={saving || needsRead}
      refreshDisabled={saving}
      selectLabel={
        local
          ? t("Default shell on this computer (local sync)")
          : t("Default shell on remote server {p0}", { p0: machine.name })
      }
      refreshLabel={t("Read current shell")}
      onChoose={(next) => {
        if (!saving) choose(next);
      }}
      onRefresh={() => setRetry((value) => value + 1)}
      feedback={
        problem ? (
          <SettingsFeedback
            state="error"
            action={
              <Button variant="ghost" disabled={saving || loading} onClick={reread}>
                {needsRead ? t("Read current shell") : t("Retry")}
              </Button>
            }
          >
            {problem}
            {needsRead && requestedShell !== null ? (
              <p>
                {t("Requested shell: {p0}", {
                  p0:
                    listed?.profiles.find((profile) => profile.id === requestedShell)?.name ??
                    (requestedShell || t("Automatic")),
                })}
              </p>
            ) : null}
          </SettingsFeedback>
        ) : saving || saved ? (
          <SettingsFeedback state={saved ? "success" : "loading"} immediate>
            {saving ? t("Saving…") : loading ? t("Asking the machine…") : t("Saved")}
          </SettingsFeedback>
        ) : null
      }
    />
  );
}
