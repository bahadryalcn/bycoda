import {
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import { useT } from "../i18n";
import { Alert } from "./Alert";
import { Button } from "./Button";
import { Checkbox } from "./Checkbox";
import { AlertCircle, CircleX } from "./icons";
import { Modal, ModalActions } from "./Modal";
import { Switch } from "./Switch";
import { TextField } from "./TextField";

/** What the owner has entered in the dialog so far. */
export type ConfirmState = {
  /** The `acknowledge` control is on (always false without one). */
  acknowledged: boolean;
  /** The `requireText` field's current text (empty without one). */
  text: string;
};

/** Passed to `onConfirm` and returned by `useConfirm().confirmWith`. */
export type ConfirmResult = { acknowledged: boolean };

export type ConfirmConsequenceTone = "neutral" | "warning" | "danger";

/** One line of "what this does": what is lost (danger), at risk (warning) or kept (neutral). */
export type ConfirmConsequenceItem = {
  key?: string;
  icon?: ComponentType<{ className?: string }>;
  tone?: ConfirmConsequenceTone;
  content: ReactNode;
};

/** A plain node is a neutral line. */
export type ConfirmConsequence = ConfirmConsequenceItem | ReactNode;

export type ConfirmRequest = {
  title: string;
  /** The question or the one-sentence outcome. */
  message: ReactNode;
  /** Label of the confirming button, e.g. "Delete". A function follows the acknowledge state. */
  confirmLabel: string | ((state: ConfirmState) => string);
  /** Defaults to "Cancel". */
  cancelLabel?: string;
  /** Label while `onConfirm` runs, e.g. "Deleting…". */
  pendingLabel?: string;
  /**
   * Destructive confirmations use the danger tone. Default true. A danger confirm is the one
   * documented destructive look: filled danger (`variant="primary" tone="danger"`), and the
   * dialog opens with focus on Cancel so Enter never destroys by accident.
   */
  danger?: boolean;
  /** Alias of `danger`: `"neutral"` is `danger: false`. `danger` wins when both are set. */
  tone?: "danger" | "neutral";
  /** Line above the title naming what the action acts on (project, worktree, session). */
  context?: ReactNode;
  /** Target detail shown under the message, such as a path in monospace. */
  details?: ReactNode;
  /** What happens, one item per line. A function follows the acknowledge state. */
  consequences?: ConfirmConsequence[] | ((state: ConfirmState) => ConfirmConsequence[]);
  /** Extra content after the consequences (a picker, a status list). The caller owns its state. */
  body?: ReactNode;
  /**
   * Type-to-confirm for an irreversible action: the confirm stays disabled until the field
   * matches. Matching trims and ignores case unless `caseSensitive`. Enter in the field confirms.
   */
  requireText?: string | { text: string; label?: string; caseSensitive?: boolean };
  /**
   * A checkbox (or switch) under the consequences. `required` keeps the confirm disabled until
   * it is on ("I understand this cannot be undone"); otherwise it is an option ("Also delete the
   * sessions") whose value reaches `onConfirm` and `confirmWith`.
   */
  acknowledge?: {
    label: string;
    description?: ReactNode;
    required?: boolean;
    defaultChecked?: boolean;
    control?: "checkbox" | "switch";
  };
  /** Blocks the confirm while the caller's preconditions are unmet (still loading, blocked). */
  confirmDisabled?: boolean;
  /** Further footer actions placed before Cancel, such as "Refresh preview". */
  extraActions?: ReactNode;
  /**
   * Optional async work run on confirm. The dialog stays open with both buttons
   * disabled until it settles; a rejection keeps the dialog open with the error
   * and the confirming button live so the owner can retry. Escape, the close
   * button and Cancel do nothing while the work is pending.
   */
  onConfirm?: (result: ConfirmResult) => void | Promise<void>;
  /**
   * Called synchronously when the owner dismisses (Escape, close, backdrop, Cancel), before
   * the promise from `confirmWith` resolves. Owners that must react in the same tick, such as
   * a dialog wrapper that restores focus or unmounts, use this instead of the promise.
   */
  onCancel?: () => void;
};

type Live = {
  /** Unique per request, so a request made while another settles never reuses its dialog state. */
  id: number;
  request: ConfirmRequest;
  resolve: (value: ConfirmResult | null) => void;
};

const CONSEQUENCE_INK: Record<ConfirmConsequenceTone, string> = {
  neutral: "",
  warning: "text-(--ui-tone-warning-fg)",
  danger: "text-(--ui-tone-danger-fg)",
};

const CONSEQUENCE_GLYPH: Record<
  ConfirmConsequenceTone,
  ComponentType<{ className?: string }> | null
> = {
  neutral: null,
  warning: AlertCircle,
  danger: CircleX,
};

function isConsequenceItem(item: ConfirmConsequence): item is ConfirmConsequenceItem {
  return (
    typeof item === "object" &&
    item !== null &&
    !isValidElement(item) &&
    !(Symbol.iterator in item) &&
    "content" in item
  );
}

/**
 * The consequence list of a confirmation: an icon per line, tone ink for what is lost or at
 * risk, neutral secondary ink for what is kept. Also for hand-built dialogs that cannot use
 * ConfirmDialog (live previews, several actions).
 * @group feedback
 * @use The consequence lines inside a confirmation or hand-built destructive dialog.
 * @avoid Plain explanatory text: a paragraph. Status lines: Alert.
 */
export function ConfirmConsequences({
  items,
  className,
}: {
  items: ConfirmConsequence[];
  className?: string;
}) {
  const visible = items.filter((item) => item !== null && item !== undefined && item !== false);
  if (!visible.length) return null;
  return (
    <ul
      className={["flex flex-col gap-2 text-ui-caption text-(--ui-text-secondary)", className]
        .filter(Boolean)
        .join(" ")}
    >
      {visible.map((item, index) => {
        const entry: ConfirmConsequenceItem = isConsequenceItem(item)
          ? item
          : { content: item as ReactNode };
        const tone = entry.tone ?? "neutral";
        const Icon = entry.icon ?? CONSEQUENCE_GLYPH[tone];
        return (
          <li key={entry.key ?? index} className="flex items-start gap-2">
            <span
              aria-hidden
              className={`flex h-(--ui-leading-caption) shrink-0 items-center ${CONSEQUENCE_INK[tone] || "text-(--ui-text-muted)"}`}
            >
              {Icon ? (
                <Icon className="icon-sm" />
              ) : (
                <span className="block size-1 rounded-full bg-current" />
              )}
            </span>
            <span className={`min-w-0 flex-1 break-words ${CONSEQUENCE_INK[tone]}`}>
              {entry.content}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function requiredText(request: ConfirmRequest) {
  const spec = request.requireText;
  if (!spec) return null;
  return typeof spec === "string" ? { text: spec, caseSensitive: false } : spec;
}

/**
 * One confirmation for multi-consequence actions: a Modal with Cancel and a
 * (danger) confirm button. Row-level deletes use ConfirmMorph instead; the Tauri
 * `ask` dialog is only for places a web overlay cannot render. Render it directly
 * with a request rebuilt from the owner's state, or through `useConfirm`. It brings its own body
 * layout, so it opts out of the default Modal padding.
 * @group overlay
 * @use Confirm a destructive or multi-consequence action with Cancel and a confirm button.
 * @avoid Row-level deletes: ConfirmMorph. Forms or choices: Modal.
 */
export function ConfirmDialog({
  request,
  onSettle,
  onResult,
}: {
  request: ConfirmRequest;
  onSettle: (value: boolean) => void;
  /** Receives the acknowledge value just before `onSettle(true)`. */
  onResult?: (result: ConfirmResult) => void;
}) {
  const t = useT();
  const dismiss = () => {
    request.onCancel?.();
    onSettle(false);
  };
  const uid = useId();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(request.acknowledge?.defaultChecked ?? false);
  const [text, setText] = useState("");
  const alive = useRef(true);
  // State lags a double click inside one tick; the ref closes that window.
  const inFlight = useRef(false);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );
  const danger = request.danger ?? request.tone !== "neutral";
  const state: ConfirmState = { acknowledged, text };
  const phrase = requiredText(request);
  const phraseMatches =
    !phrase ||
    (phrase.caseSensitive
      ? text.trim() === phrase.text
      : text.trim().toLowerCase() === phrase.text.toLowerCase());
  const ready =
    phraseMatches && (!request.acknowledge?.required || acknowledged) && !request.confirmDisabled;
  const confirmLabel =
    typeof request.confirmLabel === "function" ? request.confirmLabel(state) : request.confirmLabel;
  const consequences =
    typeof request.consequences === "function" ? request.consequences(state) : request.consequences;
  const result: ConfirmResult = { acknowledged };
  const confirm = async () => {
    if (inFlight.current || !ready) return;
    if (!request.onConfirm) {
      onResult?.(result);
      return onSettle(true);
    }
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      await request.onConfirm(result);
      onResult?.(result);
      onSettle(true);
    } catch (cause) {
      inFlight.current = false;
      if (!alive.current) return;
      setError(cause instanceof Error ? cause.message : String(cause));
      setPending(false);
    }
  };
  const acknowledgeId = `${uid}-acknowledge`;
  return (
    <Modal
      padding="none"
      size="sm"
      title={request.title}
      context={request.context}
      // Type-to-confirm starts in its field; a destructive confirm starts on Cancel.
      initialFocus={
        phrase ? "[data-confirm-text] input" : danger ? "[data-confirm-cancel]" : undefined
      }
      onClose={() => {
        if (!pending) dismiss();
      }}
      footer={
        <ModalActions>
          {request.extraActions}
          <Button variant="ghost" data-confirm-cancel="" disabled={pending} onClick={dismiss}>
            {request.cancelLabel ?? t("Cancel")}
          </Button>
          <Button
            variant="primary"
            tone={danger ? "danger" : undefined}
            loading={pending}
            loadingLabel={request.pendingLabel}
            disabled={pending || !ready}
            onClick={() => void confirm()}
          >
            {pending && request.pendingLabel ? request.pendingLabel : confirmLabel}
          </Button>
        </ModalActions>
      }
    >
      <div
        aria-busy={pending || undefined}
        className="flex flex-col gap-3 px-4 py-3 text-ui-secondary break-words text-(--ui-text-secondary)"
      >
        <p>{request.message}</p>
        {request.details ? <div className="min-w-0">{request.details}</div> : null}
        {consequences?.length ? <ConfirmConsequences items={consequences} /> : null}
        {request.body}
        {request.acknowledge ? (
          request.acknowledge.control === "switch" ? (
            <div
              className={`flex justify-between gap-3 text-ui-caption ${request.acknowledge.description ? "items-start" : "items-center"}`}
            >
              <span id={acknowledgeId} className="min-w-0">
                {request.acknowledge.label}
                {request.acknowledge.description ? (
                  <span className="mt-0.5 block text-(--ui-text-muted)">
                    {request.acknowledge.description}
                  </span>
                ) : null}
              </span>
              <Switch
                aria-labelledby={acknowledgeId}
                checked={acknowledged}
                disabled={pending}
                onCheckedChange={setAcknowledged}
              />
            </div>
          ) : (
            <label className="flex items-start gap-2 text-ui-caption">
              <Checkbox
                checked={acknowledged}
                disabled={pending}
                onChange={(event) => setAcknowledged(event.target.checked)}
                className="mt-0.5"
              />
              <span className="min-w-0">
                {request.acknowledge.label}
                {request.acknowledge.description ? (
                  <span className="mt-0.5 block text-(--ui-text-muted)">
                    {request.acknowledge.description}
                  </span>
                ) : null}
              </span>
            </label>
          )
        ) : null}
        {phrase ? (
          <div data-confirm-text="">
            <TextField
              label={phrase.label ?? t("Type “{p0}” to confirm", { p0: phrase.text })}
              value={text}
              disabled={pending}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
                event.preventDefault();
                void confirm();
              }}
            />
          </div>
        ) : null}
        {error ? (
          <Alert tone="danger" role="alert" className="break-words">
            {error}
          </Alert>
        ) : null}
      </div>
    </Modal>
  );
}

/**
 * Promise-based confirmation. `confirm()` resolves true only when the owner
 * confirms (and `onConfirm`, if any, succeeded); closing resolves false.
 * `confirmWith()` resolves the result (with the acknowledge value) or null.
 * Render `dialog` once in the owning component.
 */
export function useConfirm(): {
  confirm: (request: ConfirmRequest) => Promise<boolean>;
  confirmWith: (request: ConfirmRequest) => Promise<ConfirmResult | null>;
  dialog: ReactNode;
  /** Render the active dialog with current caller-owned content and callbacks. */
  renderDialog: (request: ConfirmRequest) => ReactNode;
} {
  const [live, setLive] = useState<Live | null>(null);
  const ref = useRef<Live | null>(null);
  const sequence = useRef(0);
  const confirmWith = useCallback(
    (request: ConfirmRequest) =>
      new Promise<ConfirmResult | null>((resolve) => {
        ref.current?.resolve(null);
        const next = { id: ++sequence.current, request, resolve };
        ref.current = next;
        setLive(next);
      }),
    [],
  );
  const confirm = useCallback(
    (request: ConfirmRequest) => confirmWith(request).then((result) => result !== null),
    [confirmWith],
  );
  useEffect(
    () => () => {
      ref.current?.resolve(null);
      ref.current = null;
    },
    [],
  );
  const result = useRef<ConfirmResult>({ acknowledged: false });
  const settle = useCallback((value: boolean) => {
    const current = ref.current;
    ref.current = null;
    setLive(null);
    current?.resolve(value ? result.current : null);
    result.current = { acknowledged: false };
  }, []);
  const renderDialog = (request: ConfirmRequest) =>
    live ? (
      <ConfirmDialog
        key={live.id}
        request={request}
        onSettle={settle}
        onResult={(value) => {
          result.current = value;
        }}
      />
    ) : null;
  return {
    confirm,
    confirmWith,
    dialog: live ? renderDialog(live.request) : null,
    renderDialog,
  };
}
