import { Tooltip } from "../../../shared/ui/Tooltip";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useT } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Link } from "../../../shared/ui/Link";
import { Popover } from "../../../shared/ui/Popover";
import { Info } from "../../../shared/ui/icons";
import type { LocalSessionReference } from "../model/localSessionReference";
import {
  useLocalSessionReferenceNavigation,
  type LocalSessionReferenceMetadata,
} from "./LocalSessionReferenceContext";

/** Awaits `run` and hands its value, failure and end to the caller; each callback checks its own request. */
async function settleRequest<T>(
  run: () => Promise<T>,
  on: { value: (value: T) => void; error: (cause: unknown) => void; done: () => void },
): Promise<void> {
  try {
    on.value(await run());
  } catch (cause) {
    on.error(cause);
  } finally {
    on.done();
  }
}

export function LocalSessionReferenceLink({
  href,
  reference,
  children,
  className,
}: {
  href: string;
  reference: LocalSessionReference;
  children: ReactNode;
  className?: string;
}) {
  const t = useT();
  const navigation = useLocalSessionReferenceNavigation();
  const trigger = useRef<HTMLButtonElement>(null);
  const sequence = useRef(0);
  const activeOpen = useRef<{ owner: typeof navigation } | null>(null);
  const id = useId();
  const [details, setDetails] = useState(false);
  const [resolved, setResolved] = useState<{
    owner: typeof navigation;
    value: LocalSessionReferenceMetadata;
  }>();
  const metadata = resolved?.owner === navigation ? resolved.value : undefined;
  const [reading, setReading] = useState(false);
  const [opening, setOpening] = useState<"session" | "beside">();
  const [error, setError] = useState<string>();
  const unavailable = t("This local session is unavailable.");

  useEffect(
    () => () => {
      sequence.current++;
    },
    [],
  );
  // The parent keys the component by URI. An authority change also invalidates
  // retained details and any in-flight continuation without changing saved prose.
  useEffect(() => {
    sequence.current++;
    activeOpen.current = null;
    setResolved(undefined);
    setDetails(false);
    setReading(false);
    setOpening(undefined);
    setError(undefined);
  }, [navigation]);

  async function readDetails() {
    if (activeOpen.current?.owner === navigation) return;
    const request = ++sequence.current;
    setReading(true);
    setResolved(undefined);
    setError(undefined);
    await settleRequest(
      async () => {
        if (!navigation) throw new Error(unavailable);
        return navigation.resolve(reference);
      },
      {
        value: (next) => {
          if (sequence.current === request) setResolved({ owner: navigation, value: next });
        },
        error: (cause) => {
          if (sequence.current === request)
            setError(cause instanceof Error ? cause.message : unavailable);
        },
        done: () => {
          if (sequence.current === request) setReading(false);
        },
      },
    );
  }

  async function open(beside = false, withoutTurn = false) {
    if (activeOpen.current?.owner === navigation) return;
    const operation = { owner: navigation };
    activeOpen.current = operation;
    const request = ++sequence.current;
    setOpening(beside ? "beside" : "session");
    setReading(false);
    setError(undefined);
    await settleRequest(
      async () => {
        if (!navigation) throw new Error(unavailable);
        await navigation.open(withoutTurn ? { locator: reference.locator } : reference, { beside });
      },
      {
        value: () => {
          if (sequence.current === request) setDetails(false);
        },
        error: (cause) => {
          if (sequence.current === request)
            setError(cause instanceof Error ? cause.message : unavailable);
        },
        done: () => {
          if (activeOpen.current === operation) activeOpen.current = null;
          if (sequence.current === request) setOpening(undefined);
        },
      },
    );
  }

  return (
    <span data-local-session-reference className="inline">
      <Tooltip label={t("Open local session")}>
        <Link
          href={href}
          className={className}
          aria-busy={!!opening || undefined}
          aria-describedby={error || opening ? id : undefined}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void open();
          }}
          onAuxClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          {children}
        </Link>
      </Tooltip>
      <Button
        ref={trigger}
        iconOnly
        label={t("Session details")}
        variant="ghost"
        size="sm"
        motion="none"
        type="button"
        aria-expanded={details}
        aria-haspopup="dialog"
        disabled={!!opening}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          const next = !details;
          setDetails(next);
          if (next) void readDetails();
        }}
      >
        <Info className="icon-sm" />
      </Button>
      {!details && (error || opening) ? (
        <span id={id} role="status" className="text-ui-caption text-(--ui-text-secondary)">
          {opening ? t("Opening session…") : error}
          {error ? (
            <Button
              type="button"
              variant="link"
              size="sm"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                void open();
              }}
            >
              {t("Retry")}
            </Button>
          ) : null}
          {error && reference.turnId ? (
            <Button
              type="button"
              variant="link"
              size="sm"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                void open(false, true);
              }}
            >
              {t("Open conversation")}
            </Button>
          ) : null}
        </span>
      ) : null}
      {details ? (
        <Popover
          anchor={trigger}
          width={320}
          maxHeight={340}
          flow="scroll"
          role="dialog"
          aria-label={t("Session details")}
          onDismiss={() => setDetails(false)}
          className="p-3 text-ui-body"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="grid min-w-0 gap-3">
            <div id={id} role="status">
              {reading ? t("Loading session details…") : null}
              {error ? <span className="text-(--ui-tone-danger-fg)">{error}</span> : null}
              {metadata ? (
                <div className="grid min-w-0 gap-1">
                  <strong className="wrap-anywhere">{metadata.title}</strong>
                  {metadata.project ? (
                    <span className="wrap-anywhere text-(--ui-text-secondary)">
                      {metadata.project}
                    </span>
                  ) : null}
                  <span className="text-ui-caption text-(--ui-text-secondary)">
                    {[
                      metadata.origin ?? t("Local"),
                      metadata.status,
                      metadata.archived ? t("Archived") : undefined,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </div>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              {error ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={reading}
                  onClick={() => void readDetails()}
                >
                  {t("Retry")}
                </Button>
              ) : null}
              {error && reference.turnId ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={!!opening || reading}
                  onClick={() => void open(false, true)}
                >
                  {t("Open conversation")}
                </Button>
              ) : null}
              <Button
                type="button"
                variant="secondary"
                size="sm"
                loading={opening === "session"}
                disabled={!!opening || reading || !metadata}
                onClick={() => void open()}
              >
                {t("Open session")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                loading={opening === "beside"}
                disabled={!!opening || reading || !metadata}
                onClick={() => void open(true)}
              >
                {t("Open beside")}
              </Button>
            </div>
          </div>
        </Popover>
      ) : null}
    </span>
  );
}
