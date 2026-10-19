// Official free Arc source adapted for bycoda native input and domain normalization.
"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { ComponentPropsWithRef, KeyboardEvent, MouseEvent } from "react";
import { AnimatePresence, motion, useAnimate, useReducedMotion } from "motion/react";
import { X as Xmark } from "../../icons";
import { Button } from "../../Button";
import { motionTokens } from "../lib/motion-tokens";
import styles from "./tag-input.module.css";

export interface TagInputProps {
  label: string;
  value?: string[];
  defaultValue?: string[];
  onValueChange?: (value: string[]) => void;
  placeholder?: string;
  description?: string;
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
}

/** Changed words rise in and unblur while unchanged words hold still. Assistive tech reads the plain copy. */
function MotionText({ text }: { text: string }) {
  const reduced = useReducedMotion();
  const words = text.split(" ");
  return (
    <>
      <span className={styles.srOnly}>{text}</span>
      <span className={styles.words} aria-hidden="true">
        <AnimatePresence initial={false} mode="popLayout">
          {words.map((word, index) => (
            <motion.span
              key={`${index}:${word}`}
              className={styles.word}
              initial={
                reduced
                  ? { opacity: 0 }
                  : { opacity: 0, y: "0.35em", filter: `blur(${motionTokens.blur.soft}px)` }
              }
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              exit={
                reduced
                  ? { opacity: 0, transition: { duration: 0 } }
                  : {
                      opacity: 0,
                      y: "-0.35em",
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
                  : { duration: motionTokens.duration.standard, ease: [...motionTokens.ease.enter] }
              }
            >
              {index < words.length - 1 ? `${word} ` : word}
            </motion.span>
          ))}
        </AnimatePresence>
      </span>
    </>
  );
}

/** Helper copy: the row opens its height on a spring, then the words settle in. */
function FieldMessage({ id, text, className }: { id?: string; text?: string; className?: string }) {
  return (
    <AnimatePresence initial={false}>
      {text ? <MessageRow key="message" id={id} text={text} className={className} /> : null}
    </AnimatePresence>
  );
}

/** The row tracks the measured copy, so a longer message that wraps opens its next line instead of snapping. */
function MessageRow({ id, text, className }: { id?: string; text: string; className?: string }) {
  const reduced = useReducedMotion();
  const copyRef = useRef<HTMLSpanElement>(null);
  const [height, setHeight] = useState<number | "auto">("auto");
  useEffect(() => {
    const node = copyRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) =>
      setHeight(entry?.borderBoxSize?.[0]?.blockSize ?? node.offsetHeight),
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  // Reduced motion mounts the row at full height: a zero-duration open would still paint one collapsed frame.
  return (
    <motion.span
      className={styles.messageSlot}
      initial={reduced ? false : { height: 0, opacity: 0 }}
      animate={{ height, opacity: 1 }}
      exit={{
        height: 0,
        opacity: 0,
        transition: reduced
          ? { duration: 0 }
          : {
              height: motionTokens.spring.smooth,
              opacity: { duration: motionTokens.duration.instant },
            },
      }}
      transition={
        reduced
          ? { duration: 0 }
          : {
              height: motionTokens.spring.smooth,
              opacity: { duration: motionTokens.duration.fast },
            }
      }
    >
      <motion.span
        ref={copyRef}
        id={id}
        className={className}
        initial={reduced ? false : { y: "0.35em", filter: `blur(${motionTokens.blur.soft}px)` }}
        animate={{ y: 0, filter: "blur(0px)" }}
        transition={{
          duration: reduced ? 0 : motionTokens.duration.standard,
          ease: [...motionTokens.ease.enter],
        }}
      >
        <MotionText text={text} />
      </motion.span>
    </motion.span>
  );
}

/**
 * Tags keep the field still: a new tag blurs in where its text was typed while the caret glides aside, a removed tag
 * leaves its slot and the rest glide in, and the shell follows wrapped rows on a spring. Backspace or the arrow keys
 * pick a tag first, a ring glides to it, and the next Backspace removes it.
 */
export function TagInput({
  label,
  value,
  defaultValue = [],
  onValueChange,
  placeholder = "Add a tag",
  description,
  id,
  className,
  inputProps,
  normalize,
  maxTags = Infinity,
  backspaceBehavior = "select",
  removeLabel = (tag) => `Remove ${tag}`,
  selectedAnnouncement = (tag) => `${tag} selected. Press Backspace to remove it.`,
  removedAnnouncement = (tag) => `Removed ${tag}`,
  formatTag = (tag) => tag,
  hideLabel = false,
}: TagInputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hintId = description ? `${inputId}-description` : undefined;
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
    onValueChange?.(next);
  }
  function pick(tag: string | null) {
    setPicked(tag);
    if (tag !== null) say(selectedAnnouncement(tag));
  }
  function add(input = draft) {
    const tag = input.trim();
    if (!tag || composing.current || inputProps?.disabled || tags.length >= maxTags) return;
    const next = (
      normalize
        ? normalize([...tags, tag])
        : tags.some((item) => item.toLowerCase() === tag.toLowerCase())
          ? tags
          : [...tags, tag]
    ).slice(0, maxTags);
    setDraft("");
    setPicked(null);
    if (next.length !== tags.length || next.some((value, index) => value !== tags[index]))
      update(next);
  }
  function remove(tag: string) {
    update(tags.filter((item) => item !== tag));
    setPicked(null);
    say(removedAnnouncement(tag));
    inputRef.current?.focus();
  }
  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
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
                <Button
                  variant="ghost"
                  size="sm"
                  iconOnly
                  type="button"
                  disabled={inputProps?.disabled}
                  onClick={() => remove(tag)}
                  label={removeLabel(tag)}
                >
                  <Xmark width={14} height={14} aria-hidden="true" />
                </Button>
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
            readOnly={inputProps?.readOnly || tags.length >= maxTags}
            onChange={(event) => {
              const next = event.currentTarget.value;
              inputProps?.onChange?.(event);
              if (
                !composing.current &&
                !(event.nativeEvent as InputEvent).isComposing &&
                next.endsWith(",")
              )
                add(next.slice(0, -1));
              else {
                setDraft(next);
                setPicked(null);
              }
            }}
            onCompositionStart={(event) => {
              composing.current = true;
              inputProps?.onCompositionStart?.(event);
            }}
            onCompositionEnd={(event) => {
              composing.current = false;
              inputProps?.onCompositionEnd?.(event);
            }}
            onKeyDown={onKeyDown}
            onBlur={(event) => {
              inputProps?.onBlur?.(event);
              if (!event.defaultPrevented) {
                add();
                setPicked(null);
              }
            }}
            placeholder={placeholder}
            aria-describedby={
              [inputProps?.["aria-describedby"], hintId].filter(Boolean).join(" ") || undefined
            }
          />
        </div>
      </motion.div>
      <span className={styles.srOnly} aria-live="polite">
        {notice}
      </span>
      <FieldMessage id={hintId} text={description} className={styles.hint} />
    </div>
  );
}
