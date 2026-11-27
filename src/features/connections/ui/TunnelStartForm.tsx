import { useId, useState, type ReactNode } from "react";
import { t } from "../../../shared/i18n";
import { Alert } from "../../../shared/ui/Alert";
import { Button } from "../../../shared/ui/Button";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { Field } from "../../../shared/ui/Field";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { InlineMessage } from "../../../shared/ui/InlineError";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { PasswordField } from "../../../shared/ui/PasswordField";
import { RadioGroup } from "../../../shared/ui/RadioGroup";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
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
    // Funnel publishes this Host only, never a dev server.
    !(provider === "tailscale" && target !== "host") &&
    (provider === "cloudflare" ||
      (!!selected?.installed && (provider === "tailscale" || selected.credential === "saved")));
  const start = (automatic: boolean) => {
    if (!canStart) return;
    void run("start", () =>
      controller.start({
        provider,
        target,
        ...(target === "dev-server" ? { localUrl } : {}),
        ...(automatic ? { automatic: true } : {}),
      }),
    )
      .then((started) => {
        if (started) onStarted?.();
      })
      .catch(() => undefined);
  };
  // Why starting is unavailable, for the footer's visible reason and the button's disabledReason.
  const blockedReason = canStart
    ? undefined
    : ready
      ? t("Set up the sharing provider first.")
      : t("Wait for the computer to answer.");
  return { canStart, blockedReason, start };
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
  onStart: (automatic: boolean) => void;
  submit?: ReactNode;
}) {
  const id = useId();
  const { controller, state, overview, ready, action, run, remoteName } = session;
  const notReadyReason = ready
    ? undefined
    : state.pending
      ? t("Wait for the current action to finish.")
      : t("Wait for the status check to finish.");
  const { provider, setProvider, target, setTarget, localUrl, setLocalUrl, token, setToken } =
    draft;
  const selected = overview?.providers.find((entry) => entry.provider === provider);
  // Funnel publishes this Host only, so choosing it moves the choice to remote access.
  const funnel = provider === "tailscale";
  return (
    <div className="external-tunnel-form">
      <RadioGroup
        label={t("What to share")}
        value={target}
        disabled={state.pending}
        onValueChange={(value) => setTarget(value as TunnelTarget)}
        options={[
          {
            value: "dev-server",
            label: t("Web app"),
            description: remoteName
              ? t(
                  "A site running on {p0}, like localhost:3000. Anyone with the link can open it.",
                  { p0: remoteName },
                )
              : t(
                  "A site running on this computer, like localhost:3000. Anyone with the link can open it.",
                ),
            disabled: funnel,
            disabledReason: funnel ? t("Tailscale Funnel shares remote access only.") : undefined,
          },
          {
            value: "host",
            label: t("Remote access"),
            description: remoteName
              ? t(
                  "Your phone and other computers reach bycoda on {p0}. Each one still has to be a paired device.",
                  { p0: remoteName },
                )
              : t(
                  "Your phone and other computers reach bycoda on this computer. Each one still has to be a paired device.",
                ),
          },
        ]}
      />
      <Field label={t("Provider")}>
        <SegmentedControl
          label={t("Tunnel provider")}
          value={provider}
          onValueChange={(value) => {
            if (state.pending) return;
            setProvider(value as TunnelProvider);
            if (value === "tailscale") setTarget("host");
          }}
          options={[
            { value: "cloudflare", label: "Cloudflare" },
            { value: "ngrok", label: "ngrok" },
            { value: "tailscale", label: t("Tailscale Funnel (public)") },
          ]}
        />
      </Field>
      <div className="external-tunnel-actions">
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
          {provider === "tailscale" ? (
            <p>
              {remoteName
                ? t(
                    "Tailscale Funnel publishes {p0} on the internet at a ts.net address. It differs from Tailscale (private), which only your own devices can reach. Funnel must be allowed for your tailnet.",
                    { p0: remoteName },
                  )
                : t(
                    "Tailscale Funnel publishes this computer on the internet at a ts.net address. It differs from Tailscale (private), which only your own devices can reach. Funnel must be allowed for your tailnet.",
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
      {(provider === "ngrok" || provider === "tailscale") && selected && !selected.installed ? (
        <InlineMessage tone="warning">
          {t("Install {p0} on {p1}, then check again.", {
            p0: provider === "ngrok" ? "ngrok" : "Tailscale",
            p1: machineLabel,
          })}
        </InlineMessage>
      ) : null}
      {provider === "ngrok" ? (
        <div className="external-tunnel-credentials">
          {selected ? (
            <InlineMessage tone={selected.credential === "saved" ? "success" : "warning"}>
              {selected.credential === "saved"
                ? remoteName
                  ? t("ngrok authtoken is saved securely on {p0}.", { p0: remoteName })
                  : t("ngrok authtoken is saved securely on this computer.")
                : selected.credential === "unavailable"
                  ? issueCopy("credential-store-unavailable")
                  : issueCopy("credential-missing")}
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
              disabledReason={
                state.pending
                  ? t("Wait for the current action to finish.")
                  : !overview
                    ? t("Wait for the status check to finish.")
                    : !token
                      ? t("Enter the ngrok authtoken first.")
                      : undefined
              }
            >
              {t("Save token securely")}
            </Button>
            {selected?.credential === "saved" ? (
              <Button
                stableWidth
                type="button"
                className="shrink-0"
                disabled={!ready}
                disabledReason={notReadyReason}
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
          onStart(new FormData(event.currentTarget).has("automatic"));
        }}
      >
        {target === "dev-server" ? (
          <>
            <TextField
              label={t("Port or local address")}
              id={`${id}-url`}
              value={localUrl}
              disabled={state.pending}
              placeholder="3000"
              onChange={(event) => setLocalUrl(event.target.value)}
              autoCapitalize="none"
              spellCheck={false}
              fieldClassName="min-w-0 flex-1"
            />
            <Alert tone="warning">
              {t(
                "Anyone with the link can open this app. bycoda puts no sign-in in front of it, so the app needs its own.",
              )}
            </Alert>
          </>
        ) : null}
        {target === "host" && provider === "cloudflare" ? (
          overview?.automaticHostAccess === true ? (
            <Button
              type="button"
              className="self-start"
              disabled={state.pending}
              loading={state.pending && action === "stop-automatic"}
              onClick={() => void run("stop-automatic", controller.stopAutomatic)}
            >
              {t("Stop automatic Host access")}
            </Button>
          ) : overview?.automaticHostAccess === false ? (
            <Checkbox
              name="automatic"
              size="secondary"
              label={t("Restart tunnel automatically")}
              description={t("bycoda updates the link in your account when the URL changes.")}
              disabled={!ready}
              disabledReason={notReadyReason}
            />
          ) : null
        ) : null}
        {submit}
      </form>
    </div>
  );
}
