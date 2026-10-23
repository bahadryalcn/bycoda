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
import { useMinuteNow } from "./RelativeSessionTime";
import {
  ProviderSignInPanel,
  type ProviderSignInState,
} from "../../features/sessions/ui/ProviderSignInPanel";
import {
  newProviderAccount,
  providerAccountExists,
  providerAccounts,
  saveProviderAccount,
  defaultProviderAccountId,
  sessionProviderAccountId,
  subscribeProviderAccounts,
  type ProviderAccountProvider,
} from "../../features/providers/model/providerAccounts";

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
  // One shared minute clock (paused while hidden); countdowns show whole minutes.
  const now = useMinuteNow();
  const [refreshing, setRefreshing] = useState(false);
  const [, setAccountsVersion] = useState(0);
  const inflight = useRef<Promise<void> | null>(null);
  // A legacy thread without a pin runs on "default", not the current default.
  const preferredClaudeAccountId = useUsageDisplayAccount("claude");
  const preferredCodexAccountId = useUsageDisplayAccount("codex");
  const claudeAccounts = providerAccounts("claude");
  const codexAccounts = providerAccounts("codex");
  const claudeAccountId = claudeAccounts.some((account) => account.id === preferredClaudeAccountId)
    ? preferredClaudeAccountId!
    : session?.harness === "claude"
      ? sessionProviderAccountId("claude", session)
      : defaultProviderAccountId("claude");
  const codexAccountId = codexAccounts.some((account) => account.id === preferredCodexAccountId)
    ? preferredCodexAccountId!
    : session?.harness === "codex"
      ? sessionProviderAccountId("codex", session)
      : defaultProviderAccountId("codex");
  const claudeAccountAvailable = providerAccountExists("claude", claudeAccountId);
  const codexAccountAvailable = providerAccountExists("codex", codexAccountId);
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
  const claude = claudeAccountAvailable
    ? cachedClaude
    : unavailableRateLimits("claude", "This conversation uses a removed account");
  const codex = codexAccountAvailable
    ? cachedCodex
    : unavailableRateLimits("codex", "This conversation uses a removed account");

  useEffect(() => subscribeProviderAccounts(() => setAccountsVersion((value) => value + 1)), []);

  const refresh = useCallback(() => {
    if (inflight.current) return inflight.current;
    setRefreshing(true);
    const jobs: Promise<unknown>[] = [];
    if (wantClaude && claudeAccountAvailable)
      jobs.push(loadRateLimits("claude", claudeAccountId, true));
    if (wantCodex && codexAccountAvailable)
      jobs.push(loadRateLimits("codex", codexAccountId, true));
    if (wantOpencode) jobs.push(loadRateLimits("opencode", "default", true));
    const run = Promise.allSettled(jobs)
      .then(() => undefined)
      .finally(() => {
        inflight.current = null;
        setRefreshing(false);
      });
    inflight.current = run;
    return run;
  }, [
    claudeAccountAvailable,
    claudeAccountId,
    codexAccountAvailable,
    codexAccountId,
    wantClaude,
    wantCodex,
    wantOpencode,
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
  const showUsage = wantClaude || wantCodex || showOpencodeChip;
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
      className={`@container/usage flex h-7 min-w-0 items-center gap-1.5 px-1.5 text-ui-micro text-(--ui-text-secondary) ${embedded ? "flex-1" : "shrink-0 border-t border-stroke"}`}
    >
      <div
        data-provider-usage
        className="scrollbar-none flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto overscroll-x-contain"
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
            <Button
              iconOnly
              label={t("Refresh usage")}
              variant="ghost"
              motion="none"
              type="button"
              className="size-7 shrink-0"
              aria-label={t("Refresh usage")}
              title={t("Refresh usage")}
              disabled={refreshing}
              onClick={() => void refresh()}
            >
              <RefreshCw
                className={`size-3.5 ${refreshing ? "motion-safe:animate-spin" : ""}`}
                strokeWidth={1.75}
                aria-hidden
              />
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
              className="size-7"
              aria-label={terminalLabel}
              aria-pressed={projectTerminalVisible}
              title={terminalUnavailableReason ?? terminalLabel}
              disabled={!!terminalUnavailableReason}
              aria-description={terminalUnavailableReason}
              onClick={onTerminalClick}
            >
              <Terminal className="icon-sm" strokeWidth={1.75} aria-hidden />
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

  useEffect(() => {
    if (!session.authRequired && loginState === "complete") {
      setLoginState("idle");
    }
  }, [loginState, session.authRequired]);

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
      <span
        className="inline-flex min-w-0 items-center gap-1.5 whitespace-nowrap"
        title={HARNESS_TITLE[session.harness]}
      >
        <HarnessIcon harness={session.harness} className="size-3.5 shrink-0" />
        <span>{HARNESS_LABEL[session.harness]}</span>
      </span>
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
        title={t("{p0} sign-in required", { p0: HARNESS_TITLE[session.harness] })}
        onClick={() => setOpen((value) => !value)}
      >
        <HarnessIcon harness={session.harness} className="size-3.5 shrink-0" />
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
  const title = terminals
    .map((terminal) => `"${terminal.process}" in ${terminal.label}`)
    .join("\n");
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
        className="size-7"
        aria-label={ariaLabel}
        aria-pressed={panelOpen}
        aria-expanded={many && !panelOpen ? menuOpen : undefined}
        aria-haspopup={many && !panelOpen ? "menu" : undefined}
        title={title}
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
        <Popover
          anchor={root}
          side="top"
          align="end"
          autoFocus
          onDismiss={() => setMenuOpen(false)}
          role="menu"
          aria-label={t("Running terminals")}
          className="min-w-[12rem] p-1"
        >
          {terminals.map((terminal) => (
            <Button
              variant="item"
              motion="none"
              key={terminal.id}
              type="button"
              role="menuitem"
              className="flex w-full items-center gap-2 leading-none"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => toggle(terminal.id)}
            >
              <span className="min-w-0 flex-1 truncate">{terminal.process}</span>
              <span className="max-w-[7rem] shrink-0 truncate text-ui-micro text-(--ui-text-secondary)">
                {terminal.label}
              </span>
            </Button>
          ))}
        </Popover>
      ) : null}
    </>
  );
}
