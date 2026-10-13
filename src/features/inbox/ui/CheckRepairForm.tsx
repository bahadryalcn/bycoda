import { fetchCheckDetails } from "../model/prChecks";
import type { CodeHostProvider } from "../model/githubPrChecks";
import { t, useLocale } from "../../../shared/i18n";
import {
  buildCiRepairRequest,
  type CiRepairEvidence,
  type CiRepairRequest,
} from "../model/ciRepair";
import { Popover, type PopoverAnchor } from "../../../shared/ui/Popover";
import {
  Check,
  ChevronRight,
  LoaderCircle,
  MessageSquare,
  Plus,
  Search,
  Sparkles,
  X,
} from "../../../shared/ui/icons";
import { useEffect, useId, useRef, useState } from "react";
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
  const [active, setActive] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const choices = [
    {
      id: "",
      get title() {
        return t("New project chat");
      },
    },
    ...repair.sessions.filter((session) =>
      (session.title || "Untitled chat")
        .toLocaleLowerCase()
        .includes(query.trim().toLocaleLowerCase()),
    ),
  ];
  const selectedTitle = sessionId
    ? repair.sessions.find((session) => session.id === sessionId)?.title || "Untitled chat"
    : "New project chat";
  useEffect(() => {
    searchRef.current?.focus();
  }, []);
  useEffect(() => {
    setActive(0);
  }, [query]);
  useEffect(() => {
    setActive((index) => Math.min(index, choices.length - 1));
  }, [choices.length]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-active="true"]`)?.scrollIntoView?.({ block: "nearest" });
  }, [active]);
  function dismiss(restoreFocus = true) {
    onClose();
    if (restoreFocus && anchor instanceof HTMLElement && anchor.isConnected) anchor.focus();
  }
  const [busy, setBusy] = useState(false);
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
    <Popover
      anchor={anchor}
      side="bottom"
      align="end"
      gap={6}
      width={320}
      maxHeight={460}
      role="dialog"
      aria-label={t("Fix checks with AI")}
      onDismiss={(reason) => dismiss(reason === "escape")}
      className="flex min-h-0 flex-col overflow-hidden"
    >
      <div className="flex shrink-0 items-start gap-2.5 px-3.5 pb-3 pt-3.5">
        <Sparkles className="mt-0.5 size-4 shrink-0 text-content/65" strokeWidth={1.75} />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium leading-5 text-content">{t("Fix with AI")}</p>
          <p
            title={checks.map((check) => check.name).join(", ")}
            className="mt-0.5 truncate text-[11px] leading-4 text-content/45"
          >
            {checks.length === 1 ? checks[0].name : t("{p0} failed checks", { p0: checks.length })}{" "}
            {t("· PR #")}
            {repair.number}
          </p>
        </div>
        <button
          type="button"
          aria-label={t("Close fix picker")}
          onClick={() => dismiss()}
          className="grid size-6 shrink-0 place-items-center rounded-md text-content/40 hover:bg-content/10 hover:text-content"
        >
          <X className="size-3.5" strokeWidth={1.75} />
        </button>
      </div>
      <label className="mx-1.5 flex h-9 shrink-0 items-center gap-2 rounded-md bg-content/5 px-2.5 text-content/40 focus-within:text-content/65">
        <Search className="size-3.5 shrink-0" strokeWidth={1.75} />
        <input
          ref={searchRef}
          value={query}
          disabled={busy}
          role="combobox"
          aria-label={t("Search project chats")}
          aria-expanded={true}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={`${listId}-${active}`}
          placeholder={t("Search chats...")}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              setActive(
                (index) =>
                  (index + (event.key === "ArrowDown" ? 1 : -1) + choices.length) % choices.length,
              );
            } else if (event.key === "Enter") {
              event.preventDefault();
              setSessionId(choices[active]?.id ?? "");
            }
          }}
          className="min-w-0 flex-1 bg-transparent text-[12px] text-content outline-none placeholder:text-content/35"
        />
      </label>
      <div
        ref={listRef}
        id={listId}
        role="listbox"
        aria-label={t("Project chats")}
        className="my-1.5 min-h-0 max-h-56 overflow-y-auto overscroll-none px-1.5"
      >
        {choices.map((session, index) => {
          const selected = sessionId === session.id;
          const Icon = session.id ? MessageSquare : Plus;
          return (
            <button
              key={session.id}
              id={`${listId}-${index}`}
              type="button"
              role="option"
              aria-label={session.title || t("Untitled chat")}
              aria-selected={selected}
              disabled={busy}
              data-active={index === active}
              onMouseEnter={() => setActive(index)}
              onFocus={() => setActive(index)}
              onClick={() => setSessionId(session.id)}
              className={`flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[12px] disabled:opacity-50 ${index === active ? "bg-selection text-content" : "text-content/70 hover:bg-content/5 hover:text-content"}`}
            >
              <Icon className="size-3.5 shrink-0 text-content/50" strokeWidth={1.75} />
              <span className="min-w-0 flex-1 truncate" title={session.title || t("Untitled chat")}>
                {session.title || t("Untitled chat")}
              </span>
              {selected ? (
                <Check className="size-3.5 shrink-0 text-content/75" strokeWidth={1.75} />
              ) : null}
            </button>
          );
        })}
        {choices.length === 1 && query.trim() ? (
          <p className="px-2.5 py-3 text-[12px] text-content/45">{t("No matching chats")}</p>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="px-3.5 pb-3 text-[12px] leading-4 text-danger">
          {error}
        </p>
      ) : null}
      {blocked && !busy ? (
        <p role="status" className="px-3.5 pb-3 text-[12px] leading-4 text-content/55">
          {t("Wait for the latest checks before starting a fix.")}
        </p>
      ) : null}
      <div className="flex shrink-0 items-center gap-3 border-t border-stroke px-3 py-2.5">
        <div className="min-w-0 flex-1 text-[11px] leading-4">
          <p className="truncate text-content/65" title={selectedTitle}>
            {selectedTitle}
          </p>
          <p className="text-content/35">{t("CI details included")}</p>
        </div>
        <button
          type="button"
          disabled={busy || blocked}
          onClick={() => void start()}
          className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md bg-selection px-2.5 text-[12px] font-medium text-content hover:bg-selection-hover disabled:opacity-50 focus-visible:outline focus-visible:outline-1 focus-visible:outline-content/50"
        >
          {busy ? <LoaderCircle className="size-3.5 animate-spin" strokeWidth={1.75} /> : null}
          {busy ? t("Preparing...") : t("Start fix")}
          {!busy ? <ChevronRight className="size-3" strokeWidth={1.75} /> : null}
        </button>
      </div>
    </Popover>
  );
}
