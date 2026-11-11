import { Button } from "../../shared/ui/Button";
import {
  useRateLimitQuery,
  loadRateLimitsForQuery as loadRateLimits,
} from "../../features/providers/model/useRateLimitQuery";
import { useQueryClient } from "@tanstack/react-query";
import { bridgeQueryEvents } from "../../shared/lib/queryClient";
import { useDismissPopover } from "../../shared/hooks/useDismissPopover";
import { useLocale, useT } from "../../shared/i18n";
import { RefreshCw, Terminal } from "../../shared/ui/icons";
import { useCallback, useEffect, useRef, useState } from "react";
import { HarnessIcon } from "../../features/sessions/ui/HarnessIcon";
import { Popover } from "../../shared/ui/Popover";
import { DropdownMenu } from "../../shared/ui/DropdownMenu";
import { Spinner } from "../../shared/ui/Spinner";
import { Tooltip } from "../../shared/ui/Tooltip";
import { consumeCodexRateLimitResetCredit } from "../../features/providers/model/rateLimitsFetch";
import {
  errorRateLimits,
  unavailableRateLimits,
  type RateLimitProvider,
} from "../../features/providers/model/rateLimits";
import {
  getCachedRateLimits,
  setCachedRateLimits,
} from "../../features/providers/model/rateLimitsCache";
import {
  HARNESS_LABEL,
  HARNESS_TITLE,
  type HarnessId,
} from "../../features/sessions/model/session";
import { loginHarness, supportsHarnessLogin } from "../../integrations/harness/core/auth";
import {
  runningTerminalChipLabel,
  type RunningTerminal,
} from "../../features/terminal/model/terminalTab";
import { MOD } from "../../platform/tauri/platform";
import { ConversationToolsButton } from "../../features/host-tools/ConversationToolsButton";
import type { ConversationTools } from "../../features/host-tools/SessionHostTools";
import { UsageProviderChip } from "./UsageProviderChip";
import {
  saveUsageDisplayAccount,
  useUsageDisplayAccount,
} from "../../features/providers/model/usageDisplayAccount";
import { WORKSPACE_REFRESH_EVENT } from "./WorkspaceControls";
import { PiUsage } from "./PiUsage";
import { useMinuteNow } from "../../shared/hooks/useMinuteNow";
import {
  ProviderSignInPanel,
  type ProviderSignInState,
} from "../../features/sessions/ui/ProviderSignInPanel";
import {
  newProviderAccount,
  providerAccountExistsIn,
  saveProviderAccount,
  defaultProviderAccountIdIn,
  sessionProviderAccountIdIn,
  type ProviderAccountProvider,
} from "../../features/providers/model/providerAccounts";
import { useProviderAccounts } from "../../features/providers/model/useProviderAccounts";

export type UsageFooterSession = {
  id?: string;
  harness: HarnessId;
  model?: string;
  authRequired?: boolean;
  providerAccountId?: string;
  providerSessionId?: string;
};

export function UsageFooter({
  embedded = false,
  providers,
  session,
  project,
  terminals = [],
  terminalOpen = false,
  onToggleTerminal,
  onNewTerminal,
  onShowTerminal,
  terminalUnavailableReason,
  projectTerminalActive = false,
  projectTerminalVisible = projectTerminalActive,
  tools,
  onSelectAccount,
  onManageAccounts,
}: {
  embedded?: boolean;
  providers: RateLimitProvider[];
  session?: UsageFooterSession;
  project?: string;
  terminals?: RunningTerminal[];
  terminalOpen?: boolean;
  onToggleTerminal?: (fileId: string) => void;
  onNewTerminal?: () => void;
  onShowTerminal?: () => void;
  terminalUnavailableReason?: string;
  projectTerminalActive?: boolean;
  projectTerminalVisible?: boolean;
  tools?: ConversationTools;
  onSelectAccount?: (provider: ProviderAccountProvider, accountId: string) => void;
  onManageAccounts?: (provider: ProviderAccountProvider) => void;
}) {
  const t = useT();
  const wantClaude = providers.includes("claude");
  const wantCodex = providers.includes("codex");
  const wantOpencode = providers.includes("opencode");
  const wantGrok = providers.includes("grok");
  // One shared minute clock (paused while hidden); countdowns show whole minutes.
  const now = useMinuteNow();
  const [refreshing, setRefreshing] = useState(false);
  const inflight = useRef<Promise<void> | null>(null);
  // Set only by refresh; null for consume/reconnect operations, which refresh joins as before.
  const inflightKey = useRef<string | null>(null);
  // A legacy thread without a pin runs on "default", not the current default.
  const preferredClaudeAccountId = useUsageDisplayAccount("claude");
  const preferredCodexAccountId = useUsageDisplayAccount("codex");
  const claudeAccounts = useProviderAccounts("claude");
  const codexAccounts = useProviderAccounts("codex");
  const claudeAccountId = claudeAccounts.some((account) => account.id === preferredClaudeAccountId)
    ? preferredClaudeAccountId!
    : session?.harness === "claude"
      ? sessionProviderAccountIdIn(claudeAccounts, session)
      : defaultProviderAccountIdIn(claudeAccounts);
  const codexAccountId = codexAccounts.some((account) => account.id === preferredCodexAccountId)
    ? preferredCodexAccountId!
    : session?.harness === "codex"
      ? sessionProviderAccountIdIn(codexAccounts, session)
      : defaultProviderAccountIdIn(codexAccounts);
  const claudeAccountAvailable = providerAccountExistsIn(claudeAccounts, claudeAccountId);
  const codexAccountAvailable = providerAccountExistsIn(codexAccounts, codexAccountId);
  const cachedClaude = useRateLimitQuery(
    "claude",
    claudeAccountId,
    wantClaude && claudeAccountAvailable,
  );
  const cachedCodex = useRateLimitQuery(
    "codex",
    codexAccountId,
    wantCodex && codexAccountAvailable,
  );
  const opencode = useRateLimitQuery("opencode", "default", wantOpencode);
  const grok = useRateLimitQuery("grok", "default", wantGrok);
  const claude = claudeAccountAvailable
    ? cachedClaude
    : unavailableRateLimits("claude", "This conversation uses a removed account");
  const codex = codexAccountAvailable
    ? cachedCodex
    : unavailableRateLimits("codex", "This conversation uses a removed account");

  const refresh = useCallback(() => {
    const targets: [RateLimitProvider, string][] = [];
    if (wantClaude && claudeAccountAvailable) targets.push(["claude", claudeAccountId]);
    if (wantCodex && codexAccountAvailable) targets.push(["codex", codexAccountId]);
    if (wantOpencode) targets.push(["opencode", "default"]);
    if (wantGrok) targets.push(["grok", "default"]);
    // A refresh for another account or provider set must not join this one.
    const key = JSON.stringify(targets);
    if (inflight.current && (inflightKey.current === null || inflightKey.current === key))
      return inflight.current;
    setRefreshing(true);
    const run = Promise.allSettled(
      targets.map(([provider, accountId]) => loadRateLimits(provider, accountId, true)),
    )
      .then(() => undefined)
      .finally(() => {
        if (inflight.current === run) {
          inflight.current = null;
          inflightKey.current = null;
        }
        setRefreshing(false);
      });
    inflight.current = run;
    inflightKey.current = key;
    return run;
  }, [
    claudeAccountAvailable,
    claudeAccountId,
    codexAccountAvailable,
    codexAccountId,
    wantClaude,
    wantCodex,
    wantOpencode,
    wantGrok,
  ]);

  const queryClient = useQueryClient();
  useEffect(
    () =>
      bridgeQueryEvents(
        queryClient,
        (receive) => {
          const reload = () => receive(undefined);
          window.addEventListener(WORKSPACE_REFRESH_EVENT, reload);
          return () => window.removeEventListener(WORKSPACE_REFRESH_EVENT, reload);
        },
        () => ({ queryKey: ["rate-limits"] }),
      ),
    [queryClient],
  );

  const consumeCodexReset = useCallback(
    async (creditId?: string) => {
      while (inflight.current) await inflight.current;
      setRefreshing(true);
      let outcome: Awaited<ReturnType<typeof consumeCodexRateLimitResetCredit>>;
      const operation = (async () => {
        try {
          outcome = await consumeCodexRateLimitResetCredit(creditId, codexAccountId);
          await loadRateLimits("codex", codexAccountId, true);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Could not use Codex reset";
          setCachedRateLimits(
            "codex",
            codexAccountId,
            errorRateLimits("codex", message, getCachedRateLimits("codex", codexAccountId)),
          );
          throw error;
        }
      })();
      const tracked = operation.finally(() => {
        inflight.current = null;
        setRefreshing(false);
      });
      inflight.current = tracked.catch(() => undefined);
      await tracked;
      return outcome!;
    },
    [codexAccountId],
  );

  const reconnectProvider = useCallback(async (provider: RateLimitProvider, accountId: string) => {
    while (inflight.current) await inflight.current;
    setRefreshing(true);
    const operation = (async () => {
      try {
        await (accountId === "default"
          ? loginHarness(provider)
          : loginHarness(provider, accountId));
        const value = await loadRateLimits(provider, accountId, true);
        if (value.status !== "ok") {
          throw new Error(
            value.error || `${HARNESS_TITLE[provider]} sign-in could not be verified`,
          );
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not complete sign-in";
        setCachedRateLimits(
          provider,
          accountId,
          errorRateLimits(provider, message, getCachedRateLimits(provider, accountId)),
        );
        throw error;
      }
    })();
    const tracked = operation.finally(() => {
      inflight.current = null;
      setRefreshing(false);
    });
    inflight.current = tracked.catch(() => undefined);
    await tracked;
  }, []);

  const reconnectClaude = useCallback(
    () => reconnectProvider("claude", claudeAccountId),
    [claudeAccountId, reconnectProvider],
  );

  const reconnectCodex = useCallback(
    () => reconnectProvider("codex", codexAccountId),
    [codexAccountId, reconnectProvider],
  );

  const selectAccount = useCallback(
    (provider: ProviderAccountProvider, accountId: string) => {
      onSelectAccount?.(provider, accountId);
    },
    [onSelectAccount],
  );

  const addAccount = useCallback(
    async (provider: ProviderAccountProvider, label: string) => {
      const account = newProviderAccount(provider, label);
      await loginHarness(provider, account.id);
      saveProviderAccount(account);
      selectAccount(provider, account.id);
      return account;
    },
    [selectAccount],
  );

  const showOpencodeChip = wantOpencode && opencode.status !== "unavailable";
  const showGrokChip = wantGrok && grok.status !== "unavailable";
  const showUsage = wantClaude || wantCodex || showOpencodeChip || showGrokChip;
  const showTerminals = terminals.length > 0;
  const showTerminalButton = Boolean(onNewTerminal || onShowTerminal || terminalUnavailableReason);
  const terminalLabel =
    projectTerminalActive || terminalUnavailableReason
      ? t("Terminal")
      : t("New Terminal ({p0}`)", { p0: MOD });
  const onTerminalClick = projectTerminalActive
    ? (onShowTerminal ?? onNewTerminal)
    : (onNewTerminal ?? onShowTerminal);
  const ariaLabel =
    showUsage || session?.harness === "pi"
      ? "Provider usage"
      : showTerminals || showTerminalButton
        ? "Terminals"
        : session
          ? "Session"
          : undefined;

  return (
    <footer
      aria-label={ariaLabel}
      className={`@container/usage flex h-(--ui-control-height-compact) min-w-0 items-center gap-1 px-1.5 text-ui-micro text-(--ui-text-secondary) ${embedded ? "flex-1" : "shrink-0 border-t border-stroke"}`}
    >
      <div
        data-provider-usage
        className="scrollbar-none flex min-w-0 flex-1 items-center gap-1 overflow-x-auto overscroll-x-contain"
      >
        {session?.harness === "pi" ? (
          <PiUsage key={`${session.id}:${session.model}`} model={session.model} now={now} />
        ) : showUsage ? (
          <>
            {wantClaude ? (
              <UsageProviderChip
                limits={claude}
                usageOnly
                now={now}
                accounts={claudeAccounts}
                accountId={claudeAccountId}
                onSelectUsageAccount={(accountId) => saveUsageDisplayAccount("claude", accountId)}
                onSelectAccount={(accountId) => selectAccount("claude", accountId)}
                onAddAccount={(label) => addAccount("claude", label)}
                onManageAccounts={onManageAccounts ? () => onManageAccounts("claude") : undefined}
                onReconnect={reconnectClaude}
              />
            ) : null}
            {wantCodex ? (
              <UsageProviderChip
                limits={codex}
                usageOnly
                now={now}
                project={project}
                accounts={codexAccounts}
                accountId={codexAccountId}
                onSelectUsageAccount={(accountId) => saveUsageDisplayAccount("codex", accountId)}
                onSelectAccount={(accountId) => selectAccount("codex", accountId)}
                onAddAccount={(label) => addAccount("codex", label)}
                onManageAccounts={onManageAccounts ? () => onManageAccounts("codex") : undefined}
                onConsumeReset={consumeCodexReset}
                onReconnect={reconnectCodex}
              />
            ) : null}
            {showOpencodeChip ? (
              <UsageProviderChip limits={opencode} now={now} project={project} />
            ) : null}
            {showGrokChip ? <UsageProviderChip limits={grok} now={now} project={project} /> : null}
            <Button
              iconOnly
              label={t("Refresh usage")}
              variant="ghost"
              motion="none"
              type="button"
              size="sm"
              className="shrink-0"
              disabled={refreshing}
              onClick={() => void refresh()}
            >
              {refreshing ? <Spinner /> : <RefreshCw className="icon-sm" aria-hidden />}
            </Button>
          </>
        ) : session ? (
          <SessionChip key={session.id ?? session.harness} session={session} />
        ) : null}
      </div>
      {tools || showTerminals || showTerminalButton ? (
        <div className="ms-auto flex shrink-0 items-center gap-1">
          {tools ? <ConversationToolsButton tools={tools} /> : null}
          {showTerminals ? (
            <RunningTerminalChip
              terminals={terminals}
              open={terminalOpen}
              onToggle={onToggleTerminal}
            />
          ) : showTerminalButton ? (
            <Button
              iconOnly
              label={terminalLabel}
              variant="ghost"
              motion="none"
              type="button"
              size="sm"
              aria-pressed={projectTerminalVisible}
              data-usage-guide="terminal-toggle"
              disabled={!!terminalUnavailableReason}
              disabledReason={terminalUnavailableReason ?? undefined}
              onClick={onTerminalClick}
            >
              <Terminal className="icon-sm" aria-hidden />
            </Button>
          ) : null}
        </div>
      ) : null}
    </footer>
  );
}

function TerminalLiveMark() {
  useLocale();
  return (
    <span className="terminal-live shrink-0" aria-hidden>
      <span className="terminal-live-bar" />
      <span className="terminal-live-bar" />
      <span className="terminal-live-bar" />
    </span>
  );
}

function SessionChip({ session }: { session: UsageFooterSession }) {
  const t = useT();
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [loginState, setLoginState] = useState<ProviderSignInState>("idle");
  const [loginError, setLoginError] = useState<string | null>(null);
  const authRequired = Boolean(session.authRequired && loginState !== "complete");
  const canLogin = authRequired && supportsHarnessLogin(session.harness);

  // A finished sign-in is forgotten once the session no longer needs auth, so a
  // later auth failure shows the sign-in prompt again.
  if (!session.authRequired && loginState === "complete") setLoginState("idle");

  const dismiss = useDismissPopover(setOpen, trigger);

  const signIn = async () => {
    setLoginState("running");
    setLoginError(null);
    try {
      await loginHarness(session.harness, session.providerAccountId);
      setOpen(false);
      setLoginState("complete");
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : "Could not complete sign-in");
      setLoginState("error");
    }
  };

  if (!canLogin) {
    return (
      <Tooltip label={HARNESS_TITLE[session.harness]}>
        <span className="inline-flex min-w-0 items-center gap-1.5 whitespace-nowrap">
          <HarnessIcon harness={session.harness} className="icon-sm shrink-0" />
          <span>{HARNESS_LABEL[session.harness]}</span>
        </span>
      </Tooltip>
    );
  }

  return (
    <>
      <Button
        variant="ghost"
        motion="none"
        ref={trigger}
        type="button"
        size="sm"
        className="min-w-0 shrink-0 gap-1.5 whitespace-nowrap"
        aria-label={t("{p0} sign-in required", { p0: HARNESS_TITLE[session.harness] })}
        aria-expanded={open}
        aria-haspopup="dialog"
        tooltip={t("{p0} sign-in required", { p0: HARNESS_TITLE[session.harness] })}
        onClick={() => setOpen((value) => !value)}
      >
        <HarnessIcon harness={session.harness} className="icon-sm shrink-0" />
        <span>{HARNESS_LABEL[session.harness]}</span>
        {authRequired ? <span className="text-ui-caption text-warning">{t("sign in")}</span> : null}
      </Button>
      {open ? (
        <Popover
          anchor={trigger}
          side="top"
          align="start"
          gap={7}
          width={300}
          autoFocus
          onDismiss={dismiss}
          role="dialog"
          aria-label={t("{p0} sign-in", { p0: HARNESS_TITLE[session.harness] })}
          tabIndex={-1}
          className="text-content"
        >
          <ProviderSignInPanel
            harness={session.harness}
            state={loginState}
            error={loginError}
            onSignIn={() => void signIn()}
          />
        </Popover>
      ) : null}
    </>
  );
}

function RunningTerminalChip({
  terminals,
  open: panelOpen,
  onToggle,
}: {
  terminals: RunningTerminal[];
  open: boolean;
  onToggle?: (fileId: string) => void;
}) {
  const t = useT();
  const root = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const label = runningTerminalChipLabel(terminals);
  const many = terminals.length > 1;
  const details = terminals.map((terminal) => `"${terminal.process}" in ${terminal.label}`);
  const ariaLabel =
    terminals.length === 1
      ? panelOpen
        ? `Hide ${terminals[0]?.process}`
        : `Show ${terminals[0]?.process}`
      : panelOpen
        ? "Hide running terminals"
        : `${terminals.length} terminals are running processes`;

  const toggle = (fileId: string) => {
    setMenuOpen(false);
    onToggle?.(fileId);
  };

  return (
    <>
      <Button
        iconOnly
        label={ariaLabel}
        variant="ghost"
        motion="none"
        ref={root}
        type="button"
        size="sm"
        aria-pressed={panelOpen}
        aria-expanded={many && !panelOpen ? menuOpen : undefined}
        aria-haspopup={many && !panelOpen ? "menu" : undefined}
        tooltipDetails={details}
        onClick={() => {
          if (panelOpen || !many) {
            const target = terminals[0];
            if (target) toggle(target.id);
            return;
          }
          setMenuOpen((value) => !value);
        }}
      >
        <TerminalLiveMark />
        <span className="sr-only">{label}</span>
      </Button>
      {menuOpen && many && !panelOpen ? (
        <DropdownMenu
          anchor={root}
          label={t("Running terminals")}
          side="top"
          align="end"
          width={192}
          items={terminals.map((terminal) => ({
            kind: "item" as const,
            id: terminal.id,
            label: terminal.process,
            description: terminal.label,
          }))}
          onPick={toggle}
          onClose={() => setMenuOpen(false)}
        />
      ) : null}
    </>
  );
}
