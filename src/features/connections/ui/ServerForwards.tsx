import { Text } from "../../../shared/ui/Text";
import { Disclosure } from "../../../shared/ui/Disclosure";
import { FieldGroup } from "../../../shared/ui/FieldGroup";
import { useSshHttpProxyApproval } from "./useSshHttpProxyApproval";
import { useRef, useState } from "react";
import { useForwardStatuses } from "./useForwardStatuses";
import { useRetainedState } from "../../../shared/hooks/useRetainedState";
import { SectionLabel } from "../../../shared/ui/SectionLabel";
import { t } from "../../../shared/i18n";
import { Badge, StatusBadge } from "../../../shared/ui/Badge";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { InlineError } from "../../../shared/ui/InlineError";
import { DetailedInlineError } from "../../../shared/ui/ErrorDetails";
import { ConfirmMorph } from "../../../shared/ui/ConfirmMorph";
import { Button } from "../../../shared/ui/Button";
import { NumberField } from "../../../shared/ui/NumberField";
import { TextField } from "../../../shared/ui/TextField";
import { RadioGroup } from "../../../shared/ui/RadioGroup";
import { SearchInput } from "../../../shared/ui/SearchInput";
import { errorText } from "./serverActionFeedback";
import { updateServerMetadata, type ServerRecord } from "../model/serverInventory";
import {
  forwardRuntimeId,
  startSshForward,
  stopSshForward,
  validateForwardRule,
} from "../model/sshForwards";

/** Saved rules belong to canonical records. Mounting/restoring never starts SSH. */
export function ServerForwards({
  server,
  expanded = false,
  active = true,
}: {
  server: ServerRecord;
  expanded?: boolean;
  active?: boolean;
}) {
  const proxy = useSshHttpProxyApproval();
  const locked = useRef(false);
  const currentSource = useRef(server.id);
  currentSource.current = server.id;
  const [draft, setDraft] = useRetainedState(`servers:forward-draft:${server.id}`, {
    name: "",
    kind: "local" as "local" | "dynamic",
    localPort: "",
    targetHost: "127.0.0.1",
    targetPort: "",
  });
  const { statuses, statusError, refresh } = useForwardStatuses(server.id, active);
  const [busyState, setBusyState] = useState({ source: server.id, value: "" });
  const [errorState, setErrorState] = useState({ source: server.id, value: "" });
  const busy = busyState.source === server.id ? busyState.value : "";
  const error = errorState.source === server.id ? errorState.value : "";
  const rules = server.metadata.forwards ?? [];
  const [search, setSearch] = useState("");
  const matchingRules = rules.filter((rule) =>
    `${rule.name} ${rule.localPort} ${rule.targetHost ?? ""} ${rule.targetPort ?? ""} ${rule.kind === "dynamic" ? "SOCKS5" : ""}`
      .toLocaleLowerCase()
      .includes(search.trim().toLocaleLowerCase()),
  );
  const run = async (id: string, action: () => Promise<unknown>) => {
    if (locked.current) return;
    locked.current = true;
    refresh(server.id);
    setBusyState({ source: server.id, value: id });
    setErrorState({ source: server.id, value: "" });
    try {
      await action();
    } catch (cause) {
      if (currentSource.current === server.id)
        setErrorState({ source: server.id, value: errorText(cause) });
    } finally {
      refresh(server.id);
      locked.current = false;
      if (currentSource.current === server.id) setBusyState({ source: server.id, value: "" });
    }
  };
  const title = (
    <>
      {t("Port forwarding")}
      {rules.length ? ` (${rules.length})` : ""}
    </>
  );
  const content = (
    <>
      <div className="mbs-3 flex min-w-0 flex-col gap-3">
        {rules.length ? (
          <SearchInput
            appearance="field"
            aria-label={t("Search forwarding rules")}
            placeholder={t("Search forwarding rules")}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        ) : (
          <EmptyState size="inline" description={t("No forwarding rules yet.")} />
        )}
        {rules.length > 0 && matchingRules.length === 0 ? (
          <EmptyState
            size="inline"
            kind="filtered"
            description={t("No matching forwarding rules.")}
            onReset={() => setSearch("")}
          />
        ) : null}
        {matchingRules.map((rule) => {
          const runtimeId = forwardRuntimeId(server.id, rule.id);
          const status = statuses.find((item) => item.id === runtimeId);
          const stopping = status?.state === "stopping";
          const unknown = status?.state === "unknown";
          const running =
            status?.state === "running" || status?.state === "starting" || stopping || unknown;
          return (
            <div key={rule.id} className="flex min-w-0 flex-col gap-2 border-b border-stroke pbe-3">
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                <Text
                  as="span"
                  size="inherit"
                  tone="inherit"
                  weight="medium"
                  className="min-w-0 break-all"
                >
                  {rule.name}
                </Text>
                {stopping || unknown ? (
                  <Badge size="sm" tone="neutral">
                    {t(stopping ? "Stopping" : "Status unknown")}
                  </Badge>
                ) : running ? (
                  <StatusBadge status="running" />
                ) : status?.state === "failed" ? (
                  <StatusBadge status="failed" />
                ) : (
                  <Badge size="sm" tone="neutral">
                    {t("Stopped")}
                  </Badge>
                )}
              </div>
              <Text as="p" size="inherit" tone="muted" className="break-all">
                {rule.kind === "dynamic"
                  ? `SOCKS5 · 127.0.0.1:${rule.localPort}`
                  : `127.0.0.1:${rule.localPort} → ${rule.targetHost}:${rule.targetPort}`}
              </Text>
              {status?.error ? <DetailedInlineError error={status.error} /> : null}
              <div className="flex flex-wrap gap-2">
                <Button
                  loading={busy === rule.id}
                  disabled={Boolean(busy) || stopping}
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
                  {stopping
                    ? t("Stopping")
                    : unknown
                      ? t("Retry stop")
                      : running
                        ? t("Stop")
                        : t("Start")}
                </Button>
                <span className="ms-auto">
                  <ConfirmMorph
                    label={t("Remove")}
                    tone="danger"
                    disabled={Boolean(busy) || running}
                    onConfirm={() =>
                      run(rule.id, () =>
                        updateServerMetadata(server.id, {
                          forwards: rules.filter((item) => item.id !== rule.id),
                        }),
                      )
                    }
                  />
                </span>
              </div>
            </div>
          );
        })}
        <Disclosure summary={t("Add forwarding rule")}>
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
            <FieldGroup variant="bare" disabled={Boolean(busy)}>
              <RadioGroup
                variant="inline"
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
            </FieldGroup>
            <TextField
              label={t("Name")}
              value={draft.name}
              maxLength={100}
              disabled={Boolean(busy)}
              onChange={(event) =>
                setDraft((previous) => ({ ...previous, name: event.target.value }))
              }
            />
            <NumberField
              label={t("Local port")}
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
                <NumberField
                  label={t("Destination port")}
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
              <Text as="p" size="inherit" tone="muted" className="break-all">
                SOCKS5 · 127.0.0.1:{draft.localPort || "…"}
              </Text>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Text size="inherit" tone="muted">
                {t("Loopback only. Start separately after saving.")}
              </Text>
              <Button type="submit" loading={busy === "save"} disabled={Boolean(busy)}>
                {t("Save rule")}
              </Button>
            </div>
          </form>
        </Disclosure>
        {error || statusError ? (
          <InlineError
            retry={!error && statusError ? { onRetry: () => refresh(server.id) } : undefined}
          >
            {error || statusError}
          </InlineError>
        ) : null}
      </div>
    </>
  );
  return (
    <>
      {expanded ? (
        <Text as="section" size="caption" tone="inherit">
          <SectionLabel as="h3">{title}</SectionLabel>
          {content}
        </Text>
      ) : (
        <Disclosure size="sm" textSize="caption" summary={title}>
          <Text as="div" size="caption" tone="inherit">
            {content}
          </Text>
        </Disclosure>
      )}
      {proxy.dialog}
    </>
  );
}
