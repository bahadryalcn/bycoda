import { useId, useState, type ReactNode } from "react";
import { t } from "../../../shared/i18n";
import { Badge } from "../../../shared/ui/Badge";
import { Button } from "../../../shared/ui/Button";
import { Field } from "../../../shared/ui/Field";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { InlineMessage } from "../../../shared/ui/InlineError";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { PasswordField } from "../../../shared/ui/PasswordField";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { Switch } from "../../../shared/ui/Switch";
import { Text } from "../../../shared/ui/Text";
import { TextField } from "../../../shared/ui/TextField";
import { RefreshCw } from "../../../shared/ui/icons";
import type { TunnelProvider, TunnelTarget } from "../../../integrations/external-tunnels";
import { issueCopy } from "./tunnelCopy";
import type { TunnelSession } from "./useTunnelSession";

/** The start form's inputs, kept by the caller so a closed dialog does not lose them. */
export function useTunnelDraft(initialLocalUrl = "3000") {
  const [provider, setProvider] = useState<TunnelProvider>("cloudflare");
  const [target, setTarget] = useState<TunnelTarget>("dev-server");
  const [localUrl, setLocalUrl] = useState(initialLocalUrl);
  const [token, setToken] = useState("");
  return { provider, setProvider, target, setTarget, localUrl, setLocalUrl, token, setToken };
}
export type TunnelDraft = ReturnType<typeof useTunnelDraft>;

/** Whether the draft can start now, and the submit that starts it. */
export function useTunnelStart(session: TunnelSession, draft: TunnelDraft, onStarted?: () => void) {
  const { controller, overview, ready, run } = session;
  const { provider, target, localUrl } = draft;
  const selected = overview?.providers.find((entry) => entry.provider === provider);
  const canStart =
    ready &&
    (provider === "cloudflare" || (!!selected?.installed && selected.credential === "saved"));
  const start = () => {
    if (!canStart) return;
    void run("start", () =>
      controller.start({ provider, target, ...(target === "dev-server" ? { localUrl } : {}) }),
    )
      .then((started) => {
        if (started) onStarted?.();
      })
      .catch(() => undefined);
  };
  return { canStart, start };
}

/**
 * Everything needed to start one tunnel on a machine: what to share, provider, provider readiness
 * and credential recovery, and the local URL. `submit` renders the start action inside the form;
 * a dialog passes `formId` to a footer button instead.
 */
export function TunnelStartForm({
  session,
  draft,
  machineLabel,
  formId,
  onStart,
  submit,
}: {
  session: TunnelSession;
  draft: TunnelDraft;
  machineLabel: string;
  formId: string;
  onStart: () => void;
  submit?: ReactNode;
}) {
  const id = useId();
  const { controller, state, overview, ready, action, run } = session;
  const { provider, setProvider, target, setTarget, localUrl, setLocalUrl, token, setToken } =
    draft;
  const selected = overview?.providers.find((entry) => entry.provider === provider);
  return (
    <div className="external-tunnel-form">
      <div className="external-tunnel-choices">
        <Field label={t("What to share")}>
          <SegmentedControl
            label={t("Tunnel target")}
            value={target}
            onValueChange={(value) => {
              if (!state.pending) setTarget(value as TunnelTarget);
            }}
            options={[
              { value: "dev-server", label: t("Dev server") },
              { value: "host", label: t("bycoda host") },
            ]}
          />
        </Field>
        <Field label={t("Provider")}>
          <SegmentedControl
            label={t("Tunnel provider")}
            value={provider}
            onValueChange={(value) => {
              if (!state.pending) setProvider(value as TunnelProvider);
            }}
            options={[
              { value: "cloudflare", label: "Cloudflare" },
              { value: "ngrok", label: "ngrok" },
            ]}
          />
        </Field>
      </div>
      {overview?.automaticHostAccess !== undefined &&
      target === "host" &&
      provider === "cloudflare" ? (
        <Switch
          label={t("Access from outside the network (Cloudflare Quick Tunnel)")}
          description={t(
            "Free temporary URL. Restarts automatically and updates your account when it changes.",
          )}
          checked={overview.automaticHostAccess === true}
          disabled={!ready || state.pending}
          onCheckedChange={(enabled) => void run("automatic", () => controller.automatic(enabled))}
        />
      ) : null}
      <div className="external-tunnel-actions">
        {selected && (selected.installed || provider === "ngrok") ? (
          <Badge variant="dot" tone={selected.installed ? "success" : "neutral"}>
            {t(selected.installed ? "{p0} CLI ready" : "{p0} CLI needed", {
              p0: provider === "cloudflare" ? "Cloudflare" : "ngrok",
            })}
          </Badge>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          iconOnly
          label={t("Check again")}
          disabled={state.pending}
          onClick={() => void controller.refresh(true)}
        >
          <RefreshCw className="icon-sm" aria-hidden />
        </Button>
        {state.phase === "loading" ? (
          <LoadingText>{t("Checking tunnel access…")}</LoadingText>
        ) : null}
        <InfoPopover label={t("Tunnel setup")}>
          {provider === "ngrok" ? (
            <p>
              {t(
                "Provider CLI and authentication must be available on the selected computer. Local URLs and ports refer to that computer.",
              )}
            </p>
          ) : null}
          {provider === "cloudflare" ? (
            <p>
              {t(
                "Cloudflare Quick Tunnels need no account. URLs are temporary and SSE is not supported.",
              )}
            </p>
          ) : null}
        </InfoPopover>
      </div>
      {provider === "ngrok" && selected && !selected.installed ? (
        <InlineMessage tone="warning">
          {t("Install {p0} on {p1}, then check again.", { p0: "ngrok", p1: machineLabel })}
        </InlineMessage>
      ) : null}
      {provider === "ngrok" ? (
        <div className="external-tunnel-credentials">
          {selected ? (
            <InlineMessage tone={selected.credential === "saved" ? "success" : "warning"}>
              {t(
                selected.credential === "saved"
                  ? "ngrok authtoken is saved securely on this computer."
                  : selected.credential === "unavailable"
                    ? issueCopy["credential-store-unavailable"]
                    : issueCopy["credential-missing"],
              )}
            </InlineMessage>
          ) : null}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (overview && !state.pending && token) {
                const value = token;
                void run("credential", () => controller.credential(value))
                  .then((saved) => {
                    if (saved) setToken((current) => (current === value ? "" : current));
                  })
                  .catch(() => undefined);
              }
            }}
          >
            <PasswordField
              label={t("ngrok authtoken")}
              id={`${id}-token`}
              value={token}
              disabled={state.pending}
              autoComplete="new-password"
              spellCheck={false}
              onChange={(event) => setToken(event.target.value)}
              fieldClassName="min-w-0 flex-1"
            />
            <Button
              stableWidth
              type="submit"
              loading={state.pending && action === "credential"}
              disabled={!overview || state.pending || !token}
            >
              {t("Save token securely")}
            </Button>
            {selected?.credential === "saved" ? (
              <Button
                stableWidth
                type="button"
                className="shrink-0"
                disabled={!ready}
                loading={state.pending && action === "forget"}
                onClick={() => void run("forget", () => controller.credential(""))}
              >
                {t("Forget saved token")}
              </Button>
            ) : null}
          </form>
        </div>
      ) : null}
      <form
        id={formId}
        className="external-tunnel-form"
        onSubmit={(event) => {
          event.preventDefault();
          onStart();
        }}
      >
        <TextField
          label={t("Local URL or port")}
          id={`${id}-url`}
          value={target === "host" ? (overview?.hostLocalUrl ?? "") : localUrl}
          readOnly={target === "host"}
          disabled={state.pending}
          placeholder="http://127.0.0.1:3000"
          onChange={(event) => setLocalUrl(event.target.value)}
          autoCapitalize="none"
          spellCheck={false}
          fieldClassName="min-w-0 flex-1"
        />
        <div className="external-tunnel-actions">
          <Text as="span" size="caption" tone="muted">
            {target === "host"
              ? t(
                  "Host access keeps device authentication and pairing. The public URL contains no device credential.",
                )
              : t("Anyone with this URL can reach the dev server. Keep access controls enabled.")}
          </Text>
        </div>
        {submit}
      </form>
    </div>
  );
}
