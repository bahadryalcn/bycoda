import { Alert } from "../../../shared/ui/Alert";
import { Button } from "../../../shared/ui/Button";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { fetchCheckDetails } from "../model/prChecks";
import type { CodeHostProvider } from "../model/githubPrChecks";
import { t, useLocale } from "../../../shared/i18n";
import {
  buildCiRepairRequest,
  type CiRepairEvidence,
  type CiRepairRequest,
} from "../model/ciRepair";
import type { PopoverAnchor } from "../../../shared/ui/Popover";
import {
  PickerFooter,
  PickerList,
  PickerPopover,
  PopoverSearchHeader,
  usePickerList,
  type PickerOption,
} from "../../../shared/ui/picker";
import { MessageSquare, Plus, Sparkles, X } from "../../../shared/ui/icons";
import { useEffect, useRef, useState } from "react";
import { type GithubPrCheck } from "../model/githubPrChecks";

export type CheckRepair = {
  provider?: CodeHostProvider;
  instance?: string;
  url?: string;
  onOpenSession?: (sessionId: string) => void | Promise<void>;
  number: number;
  sessions: readonly { id: string; title: string }[];
  onStart: (request: CiRepairRequest, sessionId?: string) => void | Promise<void>;
};

export function CheckRepairForm({
  anchor,
  checks,
  headOid,
  cwd,
  repo,
  repair,
  blocked = false,
  onClose,
}: {
  anchor: PopoverAnchor;
  checks: GithubPrCheck[];
  headOid: string;
  cwd: string;
  repo: string;
  repair: CheckRepair;
  blocked?: boolean;
  onClose: () => void;
}) {
  useLocale();
  const [sessionId, setSessionId] = useState("");
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const choices: PickerOption[] = [
    { value: "", title: t("New project chat"), icon: <Plus className="icon-sm" strokeWidth={1.75} /> },
    ...repair.sessions
      .filter((session) =>
        (session.title || "Untitled chat")
          .toLocaleLowerCase()
          .includes(query.trim().toLocaleLowerCase()),
      )
      .map((session) => ({
        value: session.id,
        title: session.title || t("Untitled chat"),
        icon: <MessageSquare className="icon-sm" strokeWidth={1.75} />,
      })),
  ];
  // Selecting a chat never closes the popover: the form's Start fix action is the commit.
  const picker = usePickerList({
    options: choices,
    value: sessionId,
    onChange: (value) => setSessionId(value),
    loop: true,
    resetKey: query,
  });
  const selectedTitle = sessionId
    ? repair.sessions.find((session) => session.id === sessionId)?.title || "Untitled chat"
    : "New project chat";
  useEffect(() => {
    searchRef.current?.focus();
  }, []);
  function dismiss(restoreFocus = false) {
    onClose();
    if (restoreFocus && anchor instanceof HTMLElement && anchor.isConnected) anchor.focus();
  }
  const [error, setError] = useState<string | null>(null);
  const starting = useRef(false);
  const mounted = useRef(true);
  const generation = useRef(0);
  useEffect(() => {
    generation.current += 1;
  }, [cwd, repo, headOid, repair.provider, repair.instance]);
  useEffect(() => {
    if (!repair.provider || repair.provider === "github") return;
    const event =
      repair.provider === "gitlab" ? "bycoda:gitlab-change" : "bycoda:azuredevops-change";
    const changed = () => {
      generation.current += 1;
      setError(t("Account changed; reload checks before repairing."));
    };
    window.addEventListener(event, changed);
    return () => window.removeEventListener(event, changed);
  }, [repair.provider]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  async function start() {
    if (starting.current || blocked) return;
    const ticket = generation.current;
    const current = () => mounted.current && generation.current === ticket;
    starting.current = true;
    setBusy(true);
    setError(null);
    try {
      const evidence = new Array<CiRepairEvidence>(checks.length);
      let nextIndex = 0;
      const loadNext = async () => {
        while (current() && nextIndex < checks.length) {
          const index = nextIndex++;
          const check = checks[index];
          let details;
          try {
            details = await fetchCheckDetails(cwd, repo, check);
          } catch (reason) {
            if (String(reason).includes("instance changed")) throw reason;
            details = {
              notice: "Job details unavailable. Inspect the check URL for logs.",
            };
          }
          if (!current()) return;
          evidence[index] = { ...check, details };
        }
      };
      await Promise.all(Array.from({ length: Math.min(3, checks.length) }, () => loadNext()));
      if (!current()) return;
      await repair.onStart(
        buildCiRepairRequest({
          provider: repair.provider,
          instance: repair.instance,
          url: repair.url,
          repo,
          number: repair.number,
          headOid,
          evidence,
        }),
        sessionId || undefined,
      );
      if (mounted.current) onClose();
    } catch (reason) {
      if (mounted.current) setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      starting.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <PickerPopover
      open
      anchor={anchor}
      side="bottom"
      align="end"
      gap={6}
      width={320}
      maxHeight={460}
      label={t("Fix checks with AI")}
      onDismiss={() => dismiss()}
      header={
        <>
          <div className="flex shrink-0 items-start gap-2.5 px-3.5 pb-3 pt-3.5">
            <Sparkles
              className="mt-0.5 icon-md shrink-0 text-(--ui-text-secondary)"
              strokeWidth={1.75}
            />
            <div className="min-w-0 flex-1">
              <p className="text-ui-secondary font-medium leading-5 text-(--ui-tone-neutral-fg)">
                {t("Fix with AI")}
              </p>
              <p
                title={checks.map((check) => check.name).join(", ")}
                className="mt-0.5 break-words text-ui-caption text-(--ui-text-secondary)"
              >
                {checks.length === 1
                  ? checks[0].name
                  : t("{p0} failed checks", { p0: checks.length })}{" "}
                {t("· PR #")}
                {repair.number}
              </p>
            </div>
            <Button
              iconOnly
              label={t("Close fix picker")}
              variant="ghost"
              type="button"
              aria-label={t("Close fix picker")}
              onClick={() => dismiss(true)}
              className="shrink-0"
            >
              <X className="icon-sm" strokeWidth={1.75} />
            </Button>
          </div>
          <PopoverSearchHeader
            ref={searchRef}
            autoFocus={false}
            label={t("Search project chats")}
            placeholder={t("Search chats...")}
            value={query}
            disabled={busy}
            onValueChange={setQuery}
            {...picker.searchProps}
          />
        </>
      }
      footer={
        <>
          {error ? (
            <Alert tone="danger" role="alert">
              {error}
            </Alert>
          ) : null}
          {blocked && !busy ? (
            <p
              role="status"
              className="px-3.5 pb-3 text-ui-caption leading-4 text-(--ui-text-secondary)"
            >
              {t("Wait for the latest checks before starting a fix.")}
            </p>
          ) : null}
          <PickerFooter align="between" className="gap-3 px-3 py-2.5">
            <div className="min-w-0 text-ui-micro leading-4">
              <p className="break-words text-(--ui-text-secondary)" title={selectedTitle}>
                {selectedTitle}
              </p>
              <p className="text-(--ui-text-secondary)">{t("CI details included")}</p>
            </div>
            <Button
              variant="ghost"
              type="button"
              disabled={blocked}
              loading={busy}
              loadingLabel={t("Preparing...")}
              onClick={() => void start()}
              className="shrink-0"
            >
              {t("Start fix")}
            </Button>
          </PickerFooter>
        </>
      }
    >
      <PickerList
        label={t("Project chats")}
        controller={picker}
        query={query}
        disabled={busy}
      />
      {choices.length === 1 && query.trim() ? (
        <EmptyState size="inline" kind="filtered" description={t("No matching chats")} />
      ) : null}
    </PickerPopover>
  );
}
