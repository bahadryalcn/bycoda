import { useSocialPending } from "./useSocialPending";
import { useContext as useSocialContext } from "react";
import { SocialBusyContext as SocialLockContext } from "./socialContext";
import { getLocale, t, useLocale } from "../../../shared/i18n";
import { Alert } from "../../../shared/ui/Alert";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { Button } from "../../../shared/ui/Button";
import { TextField } from "../../../shared/ui/TextField";
import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import type { HostProject, RemoteMachine } from "../../connections/model/protocol";

type Status = {
  environmentId: string;
  sourceMachineId: string;
  authorityMachineId?: string;
  authority: { environmentId: string; mapping: Record<string, string> } | null;
  projects: { id: string; name: string }[];
};
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

// Keep the renderer's validation consistent with the peer host contract.
function peerEndpoint(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error(t("Enter this computer's reachable HTTPS address."));
  }
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !["", "/"].includes(url.pathname) ||
    (url.protocol !== "https:" &&
      !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)))
  )
    throw new Error(t("Use an HTTPS address without user info, a path or a query."));
  return url.origin;
}

export function SocialAuthority({
  machines,
  selectedHost,
  projects,
  run,
  onSelect,
}: {
  machines: RemoteMachine[];
  selectedHost: string;
  projects: HostProject[];
  run: (work: () => Promise<unknown>) => Promise<boolean>;
  onSelect: (id: string) => void;
}) {
  const pendingUi = useSocialPending();
  const socialLocked = useSocialContext(SocialLockContext);
  useLocale();
  const [status, setStatus] = useState<Status>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [config, setConfig] = useState<{
    host: string;
    mapping: Record<string, string>;
    sourceEndpoint: string;
  }>();
  const epoch = useRef(0);
  const mounted = useRef(true);
  const pending = useRef(false);
  const selected = useRef(selectedHost);
  selected.current = selectedHost;
  const machinesVersion = JSON.stringify(
    machines.map((machine) => [machine.id, machine.environmentId, machine.endpoint]).sort(),
  );

  const loadStatus = useCallback(async () => {
    const version = ++epoch.current;
    setLoading(true);
    setError("");
    try {
      const value = await invoke<Status | null>("social_authority_status");
      if (!mounted.current || version !== epoch.current) return;
      if (!value) throw new Error(t("Could not connect to the local host."));
      setStatus(value);
    } catch (error) {
      if (mounted.current && version === epoch.current) {
        setStatus(undefined);
        setError(t("The central host setting could not be read: {p0}", { p0: errorText(error) }));
      }
    } finally {
      if (mounted.current && version === epoch.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void loadStatus();
    return () => {
      mounted.current = false;
      ++epoch.current;
    };
  }, [machinesVersion, loadStatus]);

  const target = machines.find((machine) => machine.id === selectedHost);
  const remote = !!status && status.sourceMachineId !== selectedHost && !!target;
  const savedMapping =
    status?.authorityMachineId === selectedHost ? (status.authority?.mapping ?? {}) : {};
  // Never reuse a previous target's project IDs when switching hosts.
  const current =
    config?.host === selectedHost
      ? config
      : { host: selectedHost, mapping: savedMapping, sourceEndpoint: "" };
  const validMapping = Object.fromEntries(
    Object.entries(current.mapping).filter(
      ([from, to]) =>
        status?.projects.some((project) => project.id === from) &&
        projects.some((project) => project.id === to),
    ),
  );
  const staleMappings = Object.entries(current.mapping).some(
    ([from, to]) => to && validMapping[from] !== to,
  );
  const update = (changes: Partial<typeof current>) => {
    setConfig({ ...current, ...changes });
    setError("");
    setNotice("");
  };
  const changeAuthority = async (
    machineId: string | null,
    mapping: Record<string, string>,
    sourceEndpoint: string | null,
  ) => {
    if (!status || pending.current) return;
    const requestedHost = selectedHost;
    const sourceMachineId = status.sourceMachineId;
    pending.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    let started = false;
    return run(async () => {
      started = true;
      try {
        await invoke("social_authority_connect", {
          machineId,
          mapping,
          sourceEndpoint,
        });
        if (!mounted.current) return;
        setConfig(undefined);
        setNotice(
          machineId
            ? t("Central host saved. Restart agent sessions to use the new setting.")
            : t("Returned to the local host. Sending is stopped."),
        );
        await loadStatus();
        if (mounted.current && selected.current === requestedHost)
          onSelect(machineId ?? sourceMachineId);
      } catch (error) {
        if (mounted.current)
          setError(t("The host setting could not be changed: {p0}", { p0: errorText(error) }));
        throw error;
      }
    })
      .then((success) => {
        if (!success && !started && mounted.current)
          setError(t("Another operation is in progress. Save the host setting again."));
      })
      .catch(
        (error) =>
          mounted.current &&
          setError(t("The host setting could not be changed: {p0}", { p0: errorText(error) })),
      )
      .finally(() => {
        pending.current = false;
        if (mounted.current) setBusy(false);
      });
  };

  return (
    <details className="social-form social-authority-settings" aria-busy={loading || busy}>
      <summary>{t("Use on multiple computers")}</summary>
      <p className="social-muted">
        {t(
          "Choose the main computer that manages the accounts. This setting is not needed on a single computer.",
        )}
      </p>
      {loading ? <p role="status">{t("Loading host setting…")}</p> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {!status && (!loading || pendingUi.is("read-host.try-again")) ? (
        <Button
          variant="secondary"
          loading={pendingUi.is("read-host.try-again")}
          type="button"
          disabled={busy || loading || socialLocked || busy}
          onClick={() => void pendingUi.run("read-host.try-again", () => loadStatus())}
        >
          {t("Try again")}
        </Button>
      ) : null}
      {status ? (
        <>
          <p>
            {status.authority
              ? t("Main computer: {p0}", {
                  p0:
                    machines.find((item) => item.id === status.authorityMachineId)?.name ??
                    t("Saved host (not in the connection list)"),
                })
              : t("Social media actions run on this computer.")}
          </p>
          {remote ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (busy || loading) return;
                if (staleMappings) {
                  setError(t("The project list changed. Choose the project mappings again."));
                  return;
                }
                if (!Object.keys(validMapping).length) {
                  setError(t("Match at least one project to a project on the selected host."));
                  return;
                }
                try {
                  const endpoint = peerEndpoint(current.sourceEndpoint);
                  void pendingUi.run("authority.save", () =>
                    changeAuthority(selectedHost, validMapping, endpoint),
                  );
                } catch (error) {
                  setError(errorText(error));
                }
              }}
            >
              <fieldset className="social-workspace">
                <p>
                  <strong>{t("New main computer: {p0}", { p0: target.name })}</strong>
                </p>
                <TextField
                  disabled={busy || loading || socialLocked}
                  label={t("This computer's HTTPS address")}
                  description={t(
                    "The selected host must be able to reach this address. Both hosts must be connected to each other.",
                  )}
                  required
                  type="url"
                  value={current.sourceEndpoint}
                  placeholder="https://windows-host.example"
                  onChange={(event) => update({ sourceEndpoint: event.target.value })}
                />
                <h3>{t("Project mappings")}</h3>
                {!status.projects.length ? (
                  <p>{t("There are no projects on this computer to map.")}</p>
                ) : null}
                {!projects.length ? (
                  <p>
                    {t(
                      "No projects found on the selected host. Open a project on that host first.",
                    )}
                  </p>
                ) : null}
                {status.projects.map((project) => (
                  <label key={project.id}>
                    {project.name}
                    <SearchableSelect
                      disabled={busy || loading || socialLocked}
                      value={validMapping[project.id] ?? ""}
                      label={t("Project on {p0}", { p0: target.name })}
                      options={[
                        { value: "", label: t("Do not share this project") },
                        ...projects.map((target) => ({
                          value: target.id,
                          label: target.name,
                        })),
                      ]}
                      onChange={(nextValue) =>
                        update({
                          mapping: {
                            ...validMapping,
                            [project.id]: nextValue,
                          },
                        })
                      }
                      searchLocale={getLocale()}
                    />
                  </label>
                ))}
                {staleMappings ? (
                  <Alert tone="danger">
                    {t("Some saved projects no longer exist. Choose the mappings again.")}
                  </Alert>
                ) : null}
                {!Object.keys(validMapping).length && !staleMappings ? (
                  <p className="social-muted">
                    {t("Match at least one project to a project on the selected host.")}
                  </p>
                ) : null}
                <Button
                  loading={pendingUi.is("authority.save")}
                  type="submit"
                  variant="primary"
                  disabled={
                    busy ||
                    loading ||
                    socialLocked ||
                    !Object.keys(validMapping).length ||
                    staleMappings
                  }
                >
                  {busy ? t("Saving…") : t("Use {p0}", { p0: target.name })}
                </Button>
              </fieldset>
            </form>
          ) : null}
          {status.authority ? (
            <div className="social-actions mt-2 border-t border-(--ui-tone-neutral-border) pt-2">
              <Button
                variant="secondary"
                tone="danger"
                loading={pendingUi.is("authority.return-to-this-computer-and-stop-sending")}
                type="button"
                disabled={busy || loading || socialLocked || busy || loading}
                onClick={() =>
                  pendingUi.run("authority.return-to-this-computer-and-stop-sending", () =>
                    changeAuthority(null, {}, null),
                  )
                }
              >
                {t("Return to this computer and stop sending")}
              </Button>
            </div>
          ) : null}
          <p className="social-muted">
            {t(
              "Project and account permissions also apply on the main computer. Switching computers does not grant send permission.",
            )}
          </p>
        </>
      ) : null}
      {notice ? <p role="status">{notice}</p> : null}
    </details>
  );
}
