import { useSshHttpProxyApproval } from "./useSshHttpProxyApproval";
import { useEffect, useRef, useState } from "react";
import { useRetainedState } from "../../../shared/hooks/useRetainedState";
import { t } from "../../../shared/i18n";
import { Badge } from "../../../shared/ui/Badge";
import { Button } from "../../../shared/ui/Button";
import { TextField } from "../../../shared/ui/TextField";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { updateServerMetadata, type ServerRecord } from "../model/serverInventory";
import {
  forwardRuntimeId,
  listSshForwards,
  startSshForward,
  stopSshForward,
  validateForwardRule,
  type ForwardStatus,
} from "../model/sshForwards";

/** Saved rules belong to canonical records. Mounting/restoring never starts SSH. */
export function ServerForwards({ server }: { server: ServerRecord }) {
  const proxy = useSshHttpProxyApproval();
  const locked = useRef(false);
  const [draft, setDraft] = useRetainedState(`servers:forward-draft:${server.id}`, {
    name: "",
    kind: "local" as "local" | "dynamic",
    localPort: "",
    targetHost: "127.0.0.1",
    targetPort: "",
  });
  const [statuses, setStatuses] = useState<ForwardStatus[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const rules = server.metadata.forwards ?? [];
  useEffect(() => {
    let disposed = false;
    let pending = false;
    const refresh = async () => {
      if (pending) return;
      pending = true;
      try {
        const result = await listSshForwards();
        if (!disposed) setStatuses(result.filter((item) => item.connectionId === server.id));
      } catch {
        if (!disposed) setError(t("Couldn’t read forwarding status."));
      } finally {
        pending = false;
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 1500);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [server.id]);
  const run = async (id: string, action: () => Promise<unknown>) => {
    if (locked.current) return;
    locked.current = true;
    setBusy(id);
    setError("");
    try {
      await action();
      setStatuses((await listSshForwards()).filter((item) => item.connectionId === server.id));
    } catch (cause) {
      setError(String(cause));
    } finally {
      locked.current = false;
      setBusy("");
    }
  };
  return (
    <>
      <details className="border-t border-stroke pbs-3 text-xs">
        <summary className="cursor-pointer text-(--ui-text-muted)">
          {t("Port forwarding")}
          {rules.length ? ` (${rules.length})` : ""}
        </summary>
        <div className="mbs-3 flex min-w-0 flex-col gap-3">
          {rules.map((rule) => {
            const runtimeId = forwardRuntimeId(server.id, rule.id);
            const status = statuses.find((item) => item.id === runtimeId);
            const running = status?.state === "running" || status?.state === "starting";
            return (
              <div
                key={rule.id}
                className="flex min-w-0 flex-col gap-2 border-b border-stroke pbe-3"
              >
                <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0 break-all font-medium">{rule.name}</span>
                  <Badge
                    size="sm"
                    tone={running ? "success" : status?.state === "failed" ? "danger" : "neutral"}
                  >
                    {running
                      ? t("Running")
                      : status?.state === "failed"
                        ? t("Failed")
                        : t("Stopped")}
                  </Badge>
                </div>
                <p className="break-all text-(--ui-text-muted)">
                  {rule.kind === "dynamic"
                    ? `SOCKS5 · 127.0.0.1:${rule.localPort}`
                    : `127.0.0.1:${rule.localPort} → ${rule.targetHost}:${rule.targetPort}`}
                </p>
                {status?.error ? (
                  <p role="alert" className="text-(--ui-tone-danger-fg)">
                    {status.error}
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <Button
                    loading={busy === rule.id}
                    disabled={Boolean(busy)}
                    onClick={() =>
                      void run(rule.id, async () => {
                        if (running) return stopSshForward(runtimeId);
                        const endpoint = server.effectiveSshEndpoint ?? server.sshEndpoint;
                        const ticket = endpoint
                          ? await proxy.request({
                              connectionId: server.id,
                              endpoint,
                              operation: {
                                kind: "forward",
                                id: runtimeId,
                                forwardKind: rule.kind ?? "local",
                                localPort: rule.localPort,
                                targetHost: rule.targetHost,
                                targetPort: rule.targetPort,
                              },
                            })
                          : undefined;
                        if (ticket === null) return;
                        return ticket
                          ? startSshForward(server.id, rule, ticket)
                          : startSshForward(server.id, rule);
                      })
                    }
                  >
                    {running ? t("Stop") : t("Start")}
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={Boolean(busy) || running}
                    onClick={() =>
                      void run(rule.id, () =>
                        updateServerMetadata(server.id, {
                          forwards: rules.filter((item) => item.id !== rule.id),
                        }),
                      )
                    }
                  >
                    {t("Remove")}
                  </Button>
                </div>
              </div>
            );
          })}
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void run("save", async () => {
                const rule = validateForwardRule(draft);
                await updateServerMetadata(server.id, {
                  forwards: [...rules, { ...rule, id: crypto.randomUUID() }],
                });
                setDraft((previous) =>
                  previous.kind === "dynamic"
                    ? { ...previous, name: "", localPort: "" }
                    : {
                        kind: "local",
                        name: "",
                        localPort: "",
                        targetHost: "127.0.0.1",
                        targetPort: "",
                      },
                );
              });
            }}
          >
            <fieldset disabled={Boolean(busy)} className="min-w-0 border-0 p-0">
              <SegmentedControl
                label={t("Forwarding type")}
                value={draft.kind ?? "local"}
                options={[
                  { value: "local", label: t("Local") },
                  { value: "dynamic", label: "SOCKS5" },
                ]}
                onValueChange={(value) => {
                  if (!busy)
                    setDraft((previous) => ({
                      ...previous,
                      kind: value === "dynamic" ? "dynamic" : "local",
                    }));
                }}
              />
            </fieldset>
            <TextField
              label={t("Name")}
              value={draft.name}
              maxLength={100}
              disabled={Boolean(busy)}
              onChange={(event) =>
                setDraft((previous) => ({ ...previous, name: event.target.value }))
              }
            />
            <TextField
              label={t("Local port")}
              type="number"
              min={1}
              max={65535}
              required
              value={draft.localPort}
              disabled={Boolean(busy)}
              onChange={(event) =>
                setDraft((previous) => ({ ...previous, localPort: event.target.value }))
              }
            />
            {(draft.kind ?? "local") === "local" ? (
              <>
                <TextField
                  label={t("Destination host")}
                  required
                  value={draft.targetHost}
                  disabled={Boolean(busy)}
                  onChange={(event) =>
                    setDraft((previous) => ({ ...previous, targetHost: event.target.value }))
                  }
                />
                <TextField
                  label={t("Destination port")}
                  type="number"
                  min={1}
                  max={65535}
                  required
                  value={draft.targetPort}
                  disabled={Boolean(busy)}
                  onChange={(event) =>
                    setDraft((previous) => ({ ...previous, targetPort: event.target.value }))
                  }
                />
              </>
            ) : (
              <p className="break-all text-(--ui-text-muted)">
                SOCKS5 · 127.0.0.1:{draft.localPort || "…"}
              </p>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-(--ui-text-muted)">
                {t("Loopback only. Start separately after saving.")}
              </span>
              <Button type="submit" loading={busy === "save"} disabled={Boolean(busy)}>
                {t("Save rule")}
              </Button>
            </div>
          </form>
          {error ? (
            <p role="alert" className="break-words text-(--ui-tone-danger-fg)">
              {error}
            </p>
          ) : null}
        </div>
      </details>
      {proxy.dialog}
    </>
  );
}
