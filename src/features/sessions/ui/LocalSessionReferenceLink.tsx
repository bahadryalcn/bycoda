import { presentRemoteError } from "../../connections/public/remoteFailure";
import { Text } from "../../../shared/ui/Text";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useT } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { ErrorDetails } from "../../../shared/ui/ErrorDetails";
import { InlineError } from "../../../shared/ui/InlineError";
import { LiveText } from "../../../shared/ui/LiveText";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { Link } from "../../../shared/ui/Link";
import { Popover } from "../../../shared/ui/Popover";
import { Spinner } from "../../../shared/ui/Spinner";
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
  const [error, setError] = useState<{ title: string; detail: string }>();
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
            setError({
              title: t("Could not load session details."),
              detail:
                cause instanceof Error
                  ? presentRemoteError(cause, { explicit: true })
                  : unavailable,
            });
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
            setError({
              title: t("Could not open this session."),
              detail:
                cause instanceof Error
                  ? presentRemoteError(cause, { explicit: true })
                  : unavailable,
            });
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
      <Link
        href={href}
        className={className}
        aria-busy={!!opening || undefined}
        aria-describedby={!details && error ? id : undefined}
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
        disabledReason={t("Wait for the current action to finish.")}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          const next = !details;
          setDetails(next);
          if (next) void readDetails();
        }}
      >
        {opening && !details ? <Spinner size="xs" /> : <Info className="icon-sm" />}
      </Button>
      {!details && opening ? <LiveText className="sr-only" text={t("Opening session…")} /> : null}
      {!details && error ? (
        <Text id={id} size="caption" tone="danger">
          {error.title} <ErrorDetails title={error.title} detail={error.detail} />
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
              {t("Open session")}
            </Button>
          ) : null}
        </Text>
      ) : null}
      {details ? (
        <Popover
          anchor={trigger}
          width={320}
          maxHeight={340}
          flow="scroll"
          kind="dialog"
          solid
          aria-label={t("Session details")}
          onDismiss={() => setDetails(false)}
          variant="panel"
          onClick={(event) => event.stopPropagation()}
        >
          <Text as="div" size="body" tone="inherit" className="grid min-w-0 gap-3">
            <div>
              {reading ? (
                <LoadingText delay={false}>{t("Loading session details…")}</LoadingText>
              ) : null}
              {error ? <InlineError details={error.detail}>{error.title}</InlineError> : null}
              {metadata ? (
                <div className="grid min-w-0 gap-1">
                  <strong className="wrap-anywhere">{metadata.title}</strong>
                  {metadata.project ? (
                    <Text size="inherit" tone="secondary" className="wrap-anywhere">
                      {metadata.project}
                    </Text>
                  ) : null}
                  <Text size="caption" tone="secondary">
                    {[
                      metadata.origin ?? t("Local"),
                      metadata.agentRole,
                      metadata.status,
                      metadata.archived ? t("Archived") : undefined,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </Text>
                </div>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              {error ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  loading={reading}
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
                  disabledReason={t("Wait for the current action to finish.")}
                  onClick={() => void open(false, true)}
                >
                  {metadata?.agentRole ? t("Open") : t("Open session")}
                </Button>
              ) : null}
              <Button
                type="button"
                variant="secondary"
                size="sm"
                loading={opening === "session"}
                disabled={!!opening || reading || !metadata}
                disabledReason={t("Wait for the current action to finish.")}
                onClick={() => void open()}
              >
                {metadata?.agentRole ? t("Open") : t("Open session")}
              </Button>
              {!metadata?.agentRole ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  loading={opening === "beside"}
                  disabled={!!opening || reading || !metadata}
                  disabledReason={t("Wait for the current action to finish.")}
                  onClick={() => void open(true)}
                >
                  {t("Open beside")}
                </Button>
              ) : null}
            </div>
          </Text>
        </Popover>
      ) : null}
    </span>
  );
}
