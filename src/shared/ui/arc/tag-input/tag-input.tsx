// Official free Arc source adapted for bycoda native input and domain normalization.
"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { ComponentPropsWithRef, KeyboardEvent, MouseEvent } from "react";
import { AnimatePresence, motion, useAnimate, useReducedMotion } from "motion/react";
import { X as Xmark } from "../../icons";
import { InlineAction } from "../../ActionHost";
import { motionTokens } from "../lib/motion-tokens";
import { FieldMessage } from "../lib/field-message";
import { useT } from "../../../i18n";
import { fieldDescribedBy, fieldMessageIds } from "../lib/field-ids";
import styles from "./tag-input.module.css";
import { copyNativeCaptureData } from "../../../lib/native-capture-json";
import {
  createNativeInputControlPort,
  nativeInputControlKey,
  consumeNativeInputPublication,
  issueNativeInputPublication,
  type NativeInputObserver,
  type NativeInputPublication,
  type NativeInputRead,
  type NativeInputWork,
} from "../../../lib/native-input-observer";

export interface TagInputProps {
  label: string;
  value?: string[];
  defaultValue?: string[];
  onValueChange?: (value: string[]) => unknown;
  placeholder?: string;
  description?: string;
  /** Local validation message. It precedes the helper, marks the field invalid and is announced as an alert. */
  error?: string;
  id?: string;
  className?: string;
  /** Native draft-input props. `name` serializes draft text, not committed tags. */
  inputProps?: Omit<ComponentPropsWithRef<"input">, "value" | "defaultValue">;
  normalize?: (values: string[]) => string[];
  maxTags?: number;
  backspaceBehavior?: "select" | "remove";
  removeLabel?: (tag: string) => string;
  selectedAnnouncement?: (tag: string) => string;
  removedAnnouncement?: (tag: string) => string;
  formatTag?: (tag: string) => string;
  hideLabel?: boolean;
  inputObserver?: NativeInputObserver;
  inputPublication?: NativeInputPublication;
}

/**
 * Tags keep the field still: a new tag blurs in where its text was typed while the caret glides aside, a removed tag
 * leaves its slot and the rest glide in, and the shell follows wrapped rows on a spring. Backspace or the arrow keys
 * pick a tag first, a ring glides to it, and the next Backspace removes it.
 */
export function TagInput(props: TagInputProps) {
  return <TagInputControl key={nativeInputControlKey(props.inputObserver)} {...props} />;
}

const defaultRemoveLabel = (tag: string) => `Remove ${tag}`;
const defaultSelectedAnnouncement = (tag: string) =>
  `${tag} selected. Press Backspace to remove it.`;
const defaultRemovedAnnouncement = (tag: string) => `Removed ${tag}`;
const defaultFormatTag = (tag: string) => tag;

function TagInputControl({
  label,
  value,
  defaultValue = [],
  onValueChange,
  placeholder = "Add a tag",
  description,
  error,
  id,
  className,
  inputProps,
  normalize,
  maxTags = Infinity,
  backspaceBehavior = "select",
  removeLabel = defaultRemoveLabel,
  selectedAnnouncement = defaultSelectedAnnouncement,
  removedAnnouncement = defaultRemovedAnnouncement,
  formatTag = defaultFormatTag,
  hideLabel = false,
  inputObserver,
  inputPublication,
}: TagInputProps) {
  const t = useT();
  const [admissionError, setAdmissionError] = useState<string>();
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const { description: hintId, error: errorId } = fieldMessageIds(inputId, {
    description,
    error: error || admissionError,
  });
  const [internal, setInternal] = useState(defaultValue);
  const [draft, setDraft] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const reduced = useReducedMotion();
  const [scope, animate] = useAnimate<HTMLDivElement>();
  const contentRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  const ringRef = useRef<HTMLSpanElement>(null);
  const ringAt = useRef("");
  // The shell follows its wrapped rows on a spring instead of jumping when a tag starts or leaves a line.
  const [height, setHeight] = useState<number | "auto">("auto");
  const tags = value ?? internal;
  const active = picked !== null && tags.includes(picked) ? picked : null;
  const inputPort = useRef<ReturnType<typeof createNativeInputControlPort> | null>(null);
  const requestedClosed = useRef(false);
  const [inputReadOnly, setInputReadOnly] = useState(false);
  const rawDraft = useRef("");
  const readInput = useRef<() => NativeInputRead>(() => ({ snapshot: {} }));
  const previousValue = useRef(value);
  const previousPublication = useRef(inputPublication);
  type AcceptedChange = {
    data: Readonly<{
      kind: string;
      raw: string;
      tags: readonly string[] | null;
      outcome: "pending" | "unverified" | "settled-without-view";
    }>;
    bytes: number;
  };
  // Conservative retained data budgets, not physical RSS. Unknown callbacks
  // keep their exact original data; a later success cannot evict them.
  const acceptedChanges = useRef<readonly AcceptedChange[]>([]);
  const retainedBytes = useRef(0);
  type ViewCommit = {
    port: ReturnType<typeof createNativeInputControlPort>;
    work: NativeInputWork;
    token: object;
    proof?: NativeInputPublication;
    change: AcceptedChange;
    settled: boolean;
    failed: boolean;
    viewCommitted: boolean;
    retired: boolean;
    finished: boolean;
    complete(): void;
  };
  const pendingViews = useRef<readonly ViewCommit[]>([]);
  const [committedViews, setCommittedViews] = useState<
    readonly {
      pending: ViewCommit;
      token: object;
      proof?: NativeInputPublication;
    }[]
  >([]);
  const baseReadOnly = useRef(!!inputProps?.readOnly || tags.length >= maxTags);
  useLayoutEffect(() => {
    baseReadOnly.current = !!inputProps?.readOnly || tags.length >= maxTags;
    readInput.current = () => ({
      snapshot: {
        source: "tag-input",
        tags: [...tags],
        internal: [...internal],
        draft: inputRef.current?.value ?? rawDraft.current,
        stateDraft: draft,
        picked,
        active,
        notice,
        composing: composing.current,
        acceptedChanges: acceptedChanges.current.map((change) => change.data),
      },
      ...(composing.current ? { busy: "tag-input-composition" } : {}),
    });
    if (previousValue.current !== value || previousPublication.current !== inputPublication) {
      previousValue.current = value;
      previousPublication.current = inputPublication;
      const committed =
        inputObserver &&
        consumeNativeInputPublication(inputPublication, inputObserver, value, () =>
          inputPort.current?.changed(),
        );
      if (!committed) inputPort.current?.external(() => {});
    }
    inputPort.current?.refresh();
    for (const view of committedViews)
      if (pendingViews.current.includes(view.pending) && view.pending.token === view.token)
        consumeNativeInputPublication(view.proof, view.pending.port, view.token, () =>
          view.pending.port.changed(),
        );
  });
  useLayoutEffect(() => {
    if (!inputObserver) {
      requestedClosed.current = false;
      setInputReadOnly(false);
      return;
    }
    const port = createNativeInputControlPort(inputObserver, () => readInput.current(), {
      canClose: () => !composing.current,
      close: (closed) => {
        requestedClosed.current = closed;
        if (composing.current) return;
        if (inputRef.current) inputRef.current.readOnly = closed || baseReadOnly.current;
        setInputReadOnly(closed);
      },
    });
    inputPort.current = port;
    requestedClosed.current = port.closed();
    if (!composing.current) setInputReadOnly(port.closed());
    return () => {
      port.retire();
      const retired = pendingViews.current.filter((pending) => pending.port === port);
      pendingViews.current = pendingViews.current.filter((pending) => pending.port !== port);
      for (const pending of retired) {
        pending.retired = true;
        pending.complete();
      }
      if (inputPort.current === port) inputPort.current = null;
    };
  }, [inputObserver]);
  useLayoutEffect(() => {
    const node = inputRef.current;
    if (!inputObserver || !node) return;
    const guard = (event: Event) => {
      if (inputPort.current && !inputPort.current.allowed() && !composing.current)
        event.preventDefault();
    };
    for (const type of ["beforeinput", "paste", "drop"]) node.addEventListener(type, guard, true);
    return () => {
      for (const type of ["beforeinput", "paste", "drop"])
        node.removeEventListener(type, guard, true);
    };
  });

  function mutateInput(kind: string, apply: () => unknown, requestedTags?: readonly string[]) {
    const port = inputPort.current;
    if (!port) {
      apply();
      return true;
    }
    if (!port.allowed()) return false;
    const unavailable = () =>
      setAdmissionError(
        t(
          "The input limit is busy. Your draft is kept; try again after another operation finishes.",
        ),
      );
    let change: AcceptedChange;
    try {
      const data = copyNativeCaptureData({
        kind,
        raw: rawDraft.current,
        tags: requestedTags ?? null,
        outcome: "pending" as const,
      });
      const bytes = new TextEncoder().encode(JSON.stringify(data)).byteLength + 512;
      if (acceptedChanges.current.length >= 16 || bytes > 1024 * 1024 - retainedBytes.current) {
        setAdmissionError(t("The input limit is full or unavailable. Your draft is kept."));
        return false;
      }
      change = { data, bytes };
    } catch {
      setAdmissionError(t("The input limit is full or unavailable. Your draft is kept."));
      return false;
    }
    const work = port.operation(kind);
    if (!work) {
      if (!port.closed()) unavailable();
      return false;
    }
    acceptedChanges.current = [...acceptedChanges.current, change];
    retainedBytes.current += change.bytes;
    const currentOwner = () => port.live && inputPort.current === port;
    const pending: ViewCommit = {
      port,
      work,
      token: {},
      change,
      settled: false,
      failed: false,
      viewCommitted: false,
      retired: false,
      finished: false,
      complete: () => {
        if (pending.finished || !pending.settled || (!pending.viewCommitted && !pending.retired))
          return;
        pending.finished = true;
        pendingViews.current = pendingViews.current.filter((item) => item !== pending);
        if (!pending.failed && pending.viewCommitted) {
          acceptedChanges.current = acceptedChanges.current.filter((item) => item !== change);
          retainedBytes.current -= change.bytes;
        }
        if (!currentOwner())
          port.retiredOutcome({
            acceptedChanges: acceptedChanges.current.map((item) => item.data),
          });
        port.changed();
        port.finish(work);
      },
    };
    const publishView = () => {
      pending.viewCommitted = false;
      const token = {};
      pending.token = token;
      pending.proof = issueNativeInputPublication({
        target: port,
        value: token,
        current: () =>
          currentOwner() && pending.token === token && pendingViews.current.includes(pending),
        apply: (callback) => work.apply(callback),
        committed: () => {
          pending.viewCommitted = true;
          pending.complete();
        },
      });
      // New record identity binds the exact React publication, including a
      // rejected callback's final feedback. An earlier render is not its ACK.
      setCommittedViews(
        pendingViews.current.map((item) => ({
          pending: item,
          token: item.token,
          proof: item.proof,
        })),
      );
    };
    pendingViews.current = [...pendingViews.current, pending];
    const settleResult = (failed: boolean) => {
      if (pending.settled) return;
      const outcome = () => {
        pending.failed = failed;
        pending.settled = true;
        if (failed)
          change.data = copyNativeCaptureData({ ...change.data, outcome: "unverified" as const });
        if (currentOwner()) {
          if (failed) {
            setAdmissionError(t("Could not verify the tag change. Your current tags are kept."));
            publishView();
          }
        } else {
          pending.retired = true;
          if (!failed && !pending.viewCommitted)
            change.data = copyNativeCaptureData({
              ...change.data,
              outcome: "settled-without-view" as const,
            });
          port.retiredOutcome({
            acceptedChanges: acceptedChanges.current.map((item) => item.data),
          });
        }
        port.changed();
        pending.complete();
      };
      try {
        work.apply(outcome);
      } catch {
        // Bookkeeping failure supplies no success or replay permission. Keep
        // exact request bytes and invalidate the cut before releasing the job.
        pending.failed = true;
        pending.settled = true;
        change.data = copyNativeCaptureData({ ...change.data, outcome: "unverified" as const });
        port.external(() => {});
        if (!currentOwner()) {
          pending.retired = true;
          port.retiredOutcome({
            acceptedChanges: acceptedChanges.current.map((item) => item.data),
          });
        }
        pending.complete();
      }
    };
    let result: unknown;
    try {
      result = work.apply(apply);
      port.changed();
    } catch {
      settleResult(true);
      return true;
    }
    if (currentOwner()) publishView();
    else pending.retired = true;
    void Promise.resolve(result)
      .then(
        () => settleResult(false),
        () => settleResult(true),
      )
      .catch(() => {
        // A final bookkeeping failure leaves the actual job held. It cannot
        // orphan a rejection, fabricate a successful capture or replay a callback.
      });
    return true;
  }
  useEffect(() => {
    const node = contentRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      // Hidden workbench panes have no layout box. Retain the last real height
      // so showing the pane does not animate its tags out of a clipped zero row.
      if (node.offsetHeight > 0) setHeight(node.offsetHeight);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  // The ring measures the picked tag's resting box, glides between picks, and fades in place when the pick clears.
  useLayoutEffect(() => {
    const ring = ringRef.current;
    const node =
      active === null
        ? null
        : contentRef.current?.querySelector<HTMLElement>(`[data-tag="${CSS.escape(active)}"]`);
    if (!ring) return;
    // It leaves on the same curve as a removed tag, so a picked tag and its ring fade out as one piece.
    if (!node) {
      if (ringAt.current)
        animate(ring, reduced ? { opacity: 0 } : { opacity: 0, scale: 0.9 }, {
          duration: reduced ? 0 : motionTokens.duration.instant,
          ease: [...motionTokens.ease.standard],
        });
      ringAt.current = "";
      return;
    }
    const box = {
      x: node.offsetLeft,
      y: node.offsetTop,
      width: node.offsetWidth,
      height: node.offsetHeight,
    };
    const at = Object.values(box).join(" ");
    if (at === ringAt.current) return;
    // A ring that is still fading from the last pick glides on to the next one, so quick Backspaces read as one motion.
    if (!reduced && (ringAt.current || Number(getComputedStyle(ring).opacity) > 0.02))
      animate(
        ring,
        { ...box, opacity: 1, scale: 1 },
        { ...motionTokens.spring.morph, opacity: { duration: motionTokens.duration.fast } },
      );
    else
      animate(
        ring,
        { ...box, opacity: [0, 1], scale: [reduced ? 1 : 0.9, 1] },
        reduced
          ? { duration: 0, opacity: { duration: motionTokens.duration.instant } }
          : {
              duration: 0,
              opacity: { duration: motionTokens.duration.fast },
              scale: motionTokens.spring.snappy,
            },
      );
    ringAt.current = at;
  });
  function say(message: string) {
    setNotice((previous) => (previous === message ? `${message}\u00a0` : message));
  }
  function update(next: string[]) {
    if (value === undefined) setInternal(next);
    return onValueChange?.(next);
  }
  function pick(tag: string | null) {
    const port = inputPort.current;
    if (port && !port.allowed()) return;
    setPicked(tag);
    if (tag !== null) say(selectedAnnouncement(tag));
    port?.changed();
  }
  function add(input = draft) {
    if (inputPort.current && !inputPort.current.allowed()) return false;
    const tag = input.trim();
    if (!tag || composing.current || inputProps?.disabled || tags.length >= maxTags) return false;
    const next = (
      normalize
        ? normalize([...tags, tag])
        : tags.some((item) => item.toLowerCase() === tag.toLowerCase())
          ? tags
          : [...tags, tag]
    ).slice(0, maxTags);
    return mutateInput(
      "tag-add",
      () => {
        setAdmissionError(undefined);
        rawDraft.current = "";
        setDraft("");
        setPicked(null);
        if (next.length !== tags.length || next.some((value, index) => value !== tags[index]))
          return update(next);
      },
      next,
    );
  }
  function remove(tag: string) {
    const next = tags.filter((item) => item !== tag);
    mutateInput(
      "tag-remove",
      () => {
        const result = update(next);
        setPicked(null);
        say(removedAnnouncement(tag));
        inputRef.current?.focus();
        return result;
      },
      next,
    );
  }
  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (inputPort.current && !inputPort.current.allowed()) {
      if (["Enter", ",", "Backspace", "Delete"].includes(event.key)) event.preventDefault();
      return;
    }
    inputProps?.onKeyDown?.(event);
    if (
      event.defaultPrevented ||
      composing.current ||
      event.nativeEvent.isComposing ||
      event.keyCode === 229
    )
      return;
    const { key, currentTarget: input } = event;
    const atStart = input.selectionStart === 0 && input.selectionEnd === 0;
    const index = active === null ? tags.length : tags.indexOf(active);
    let handled = true;
    if (key === "Enter" || key === ",") add();
    else if ((key === "Backspace" || key === "Delete") && active !== null) remove(active);
    else if (key === "Backspace" && !draft && tags.length && backspaceBehavior === "remove")
      remove(tags[tags.length - 1]!);
    else if (key === "Backspace" && atStart && tags.length) pick(tags[tags.length - 1]!);
    else if (key === "ArrowLeft" && (atStart || active !== null) && index > 0)
      pick(tags[index - 1]!);
    else if (key === "ArrowRight" && active !== null) pick(tags[index + 1] ?? null);
    else if (key === "Escape" && active !== null) pick(null);
    else handled = false;
    if (handled) event.preventDefault();
  }
  // A click on a tag picks it without taking focus from the field. The remove button keeps its own press.
  function onTagPointer(event: MouseEvent<HTMLElement>, tag?: string) {
    if ((event.target as HTMLElement).closest("button")) return;
    if (!tag) {
      event.preventDefault();
      return;
    }
    pick(active === tag ? null : tag);
    inputRef.current?.focus();
  }
  const move = reduced ? { duration: 0 } : motionTokens.spring.morph;
  const glide = reduced ? { duration: 0 } : motionTokens.spring.smooth;
  return (
    <div
      className={[styles.field, className].filter(Boolean).join(" ")}
      role="group"
      aria-label={label}
    >
      {hideLabel ? null : <label htmlFor={inputId}>{label}</label>}
      <motion.div
        ref={scope}
        className={styles.control}
        data-invalid={error ? "" : undefined}
        data-disabled={inputProps?.disabled ? "" : undefined}
        data-readonly={
          (inputReadOnly || inputProps?.readOnly) && !inputProps?.disabled ? "" : undefined
        }
        data-ui-focus-group
        initial={false}
        animate={{ height }}
        transition={glide}
      >
        <div
          ref={contentRef}
          className={styles.content}
          onClick={(event) => {
            if (event.target === event.currentTarget) inputRef.current?.focus();
          }}
        >
          <span ref={ringRef} className={styles.ring} aria-hidden="true" />
          <AnimatePresence initial={false}>
            {!draft && !tags.length && (
              <motion.span
                key="placeholder"
                className={styles.placeholder}
                aria-hidden="true"
                initial={
                  reduced
                    ? { opacity: 0 }
                    : { opacity: 0, y: "0.3em", filter: `blur(${motionTokens.blur.soft}px)` }
                }
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                exit={{ opacity: 0, transition: { duration: 0 } }}
                transition={
                  reduced
                    ? { duration: motionTokens.duration.instant }
                    : {
                        duration: motionTokens.duration.standard,
                        ease: [...motionTokens.ease.enter],
                      }
                }
              >
                {placeholder}
              </motion.span>
            )}
          </AnimatePresence>
          <AnimatePresence initial={false} mode="popLayout">
            {tags.map((tag) => (
              <motion.span
                layout={reduced ? false : "position"}
                className={styles.tag}
                key={tag}
                data-tag={tag}
                data-picked={tag === active || undefined}
                onMouseDown={(event) => onTagPointer(event)}
                onClick={(event) => onTagPointer(event, tag)}
                initial={
                  reduced
                    ? { opacity: 0 }
                    : { opacity: 0, scale: 0.9, filter: `blur(${motionTokens.blur.soft}px)` }
                }
                animate={{
                  opacity: 1,
                  scale: 1,
                  filter: "blur(0px)",
                  transitionEnd: { filter: "none" },
                }}
                exit={
                  reduced
                    ? { opacity: 0, transition: { duration: 0 } }
                    : {
                        opacity: 0,
                        scale: 0.9,
                        filter: `blur(${motionTokens.blur.subtle}px)`,
                        transition: {
                          duration: motionTokens.duration.instant,
                          ease: [...motionTokens.ease.standard],
                        },
                      }
                }
                transition={
                  reduced
                    ? { duration: motionTokens.duration.instant }
                    : {
                        ...motionTokens.spring.morph,
                        layout: move,
                        opacity: {
                          duration: motionTokens.duration.fast,
                          ease: [...motionTokens.ease.enter],
                        },
                        filter: {
                          duration: motionTokens.duration.standard,
                          ease: [...motionTokens.ease.enter],
                        },
                      }
                }
              >
                <span className={styles.tagLabel}>{formatTag(tag)}</span>
                <InlineAction
                  reveal="always"
                  disabled={inputProps?.disabled}
                  aria-disabled={inputReadOnly || undefined}
                  onClick={() => remove(tag)}
                  label={removeLabel(tag)}
                >
                  <Xmark aria-hidden="true" />
                </InlineAction>
              </motion.span>
            ))}
          </AnimatePresence>
          <input
            data-ui-focus="group"
            {...inputProps}
            aria-label={inputProps?.["aria-label"] ?? (hideLabel ? label : undefined)}
            ref={(element) => {
              inputRef.current = element;
              const ref = inputProps?.ref;
              if (typeof ref === "function") return ref(element);
              if (ref) ref.current = element;
            }}
            id={inputId}
            value={draft}
            readOnly={inputReadOnly || inputProps?.readOnly || tags.length >= maxTags}
            onBeforeInput={(event) => {
              if (inputPort.current && !inputPort.current.allowed()) {
                event.preventDefault();
                return;
              }
              inputProps?.onBeforeInput?.(event);
            }}
            onChange={(event) => {
              const next = event.currentTarget.value;
              const port = inputPort.current;
              if (port && !port.allowed()) {
                port.external(() => {
                  rawDraft.current = next;
                  setDraft(next);
                });
                return;
              }
              rawDraft.current = next;
              setAdmissionError(undefined);
              inputProps?.onChange?.(event);
              if (
                !composing.current &&
                !(event.nativeEvent as InputEvent).isComposing &&
                next.endsWith(",")
              ) {
                if (!add(next.slice(0, -1)) && port) {
                  // A refused registered commit retains every raw character,
                  // including the comma that triggered it.
                  setDraft(next);
                  setPicked(null);
                }
              } else {
                setDraft(next);
                setPicked(null);
              }
              port?.changed();
            }}
            onCompositionStart={(event) => {
              composing.current = true;
              inputPort.current?.external(() => {});
              inputProps?.onCompositionStart?.(event);
            }}
            onCompositionEnd={(event) => {
              composing.current = false;
              setInputReadOnly(requestedClosed.current);
              inputPort.current?.changed();
              inputProps?.onCompositionEnd?.(event);
            }}
            onKeyDown={onKeyDown}
            onBlur={(event) => {
              if (inputPort.current && !inputPort.current.allowed()) return;
              mutateInput("tag-blur", () => {
                inputProps?.onBlur?.(event);
                if (!event.defaultPrevented) {
                  add();
                  setPicked(null);
                }
              });
            }}
            placeholder={placeholder}
            aria-invalid={error ? true : inputProps?.["aria-invalid"]}
            aria-describedby={fieldDescribedBy(
              inputId,
              { description, error },
              inputProps?.["aria-describedby"],
            )}
          />
        </div>
      </motion.div>
      <span className={styles.srOnly} aria-live="polite">
        {notice}
      </span>
      <FieldMessage id={errorId} text={error || admissionError} className={styles.error} alert />
      <FieldMessage id={hintId} text={description} className={styles.hint} />
    </div>
  );
}
