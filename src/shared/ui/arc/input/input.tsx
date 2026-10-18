"use client";

import { forwardRef, useId, useState } from "react";
import type { InputHTMLAttributes, ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { motionTokens } from "../lib/motion-tokens";
import styles from "./input.module.css";
import { SearchInput } from "../../SearchInput";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  description?: string;
  error?: string;
  /** Adapter hooks for a compact field with an existing visible label. */
  fieldClassName?: string;
  hideLabel?: boolean;
  clearable?: boolean;
  /** A compact trailing icon action, separate from the label and messages. */
  endAdornment?: ReactNode;
}

/* Digits roll up when a number grows and down when it shrinks; `custom` hands the latest direction to digits already leaving. */
const digit = {
  enter: (direction: number) => ({
    opacity: 0,
    y: `${direction * 0.6}em`,
  }),
  center: { opacity: 1, y: 0 },
  exit: (direction: number) => ({
    opacity: 0,
    y: `${direction * -0.6}em`,
  }),
};
const isNumber = (word: string) => /^\d[\d.,/:]*%?$/.test(word);

/** A count in the copy, such as "12 characters", rolls only the digits that changed; a gained or lost digit opens or closes its width. */
function RollingNumber({ word }: { word: string }) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState({ word, direction: 1 });
  if (shown.word !== word)
    setShown({
      word,
      direction:
        parseFloat(word.replace(/,/g, "")) < parseFloat(shown.word.replace(/,/g, "")) ? -1 : 1,
    });
  const characters = word.split("");
  const transition = reduced
    ? { duration: 0 }
    : {
        y: motionTokens.spring.snappy,
        width: motionTokens.spring.morph,
        opacity: { duration: motionTokens.duration.fast },
      };
  return (
    <AnimatePresence initial={false}>
      {characters.map((character, index) => (
        <motion.span
          key={characters.length - index}
          className={styles.column}
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: "auto", opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={transition}
        >
          <AnimatePresence initial={false} mode="popLayout" custom={shown.direction}>
            <motion.span
              key={character}
              custom={shown.direction}
              variants={digit}
              initial="enter"
              animate="center"
              exit="exit"
              transition={transition}
            >
              {character}
            </motion.span>
          </AnimatePresence>
        </motion.span>
      ))}
    </AnimatePresence>
  );
}

/** Changed words rise in and fade while unchanged words hold still, and numbers roll. Assistive tech reads the plain copy. */
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
              key={`${index}:${isNumber(word) ? "#" : word}`}
              className={styles.word}
              initial={reduced ? { opacity: 0 } : { opacity: 0, y: "0.35em" }}
              animate={{ opacity: 1, y: 0 }}
              exit={
                reduced
                  ? { opacity: 0, transition: { duration: 0 } }
                  : {
                      opacity: 0,
                      y: "-0.35em",
                      transition: {
                        duration: motionTokens.duration.exit,
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
              {isNumber(word) ? <RollingNumber word={word} /> : word}
              {index < words.length - 1 ? " " : null}
            </motion.span>
          ))}
        </AnimatePresence>
      </span>
    </>
  );
}

/** Helper and error copy: the row opens its height on a spring, then the words settle in. */
function FieldMessage({
  id,
  text,
  className,
  alert,
}: {
  id?: string;
  text?: string;
  className?: string;
  alert?: boolean;
}) {
  return (
    <AnimatePresence initial={false}>
      {text ? (
        <MessageRow key="message" id={id} text={text} className={className} alert={alert} />
      ) : null}
    </AnimatePresence>
  );
}

/** The grid track reveals the natural message height without a measurement observer. */
function MessageRow({
  id,
  text,
  className,
  alert,
}: {
  id?: string;
  text: string;
  className?: string;
  alert?: boolean;
}) {
  const reduced = useReducedMotion();
  // Reduced motion mounts the row at full height: a zero-duration open would still paint one collapsed frame. The presence starts
  // with initial={false}, so rows present at hydration render the same on server and client either way.
  return (
    <motion.span
      className={styles.messageSlot}
      initial={reduced ? false : { gridTemplateRows: "0fr", opacity: 0 }}
      animate={{ gridTemplateRows: "1fr", opacity: 1 }}
      exit={{
        gridTemplateRows: "0fr",
        opacity: 0,
        transition: reduced
          ? { duration: 0 }
          : {
              gridTemplateRows: motionTokens.spring.smooth,
              opacity: { duration: motionTokens.duration.instant },
            },
      }}
      transition={
        reduced
          ? { duration: 0 }
          : {
              gridTemplateRows: motionTokens.spring.smooth,
              opacity: { duration: motionTokens.duration.fast },
            }
      }
    >
      <span className={styles.messageClip}>
        <motion.span
          id={id}
          className={className}
          role={alert ? "alert" : undefined}
          initial={reduced ? false : { y: "0.35em" }}
          animate={{ y: 0 }}
          transition={{
            duration: reduced ? 0 : motionTokens.duration.standard,
            ease: [...motionTokens.ease.enter],
          }}
        >
          <MotionText text={text} />
        </motion.span>
      </span>
    </motion.span>
  );
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    label,
    description,
    error,
    id,
    className,
    fieldClassName,
    hideLabel = false,
    clearable = false,
    endAdornment,
    ...props
  },
  ref,
) {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const hintId = description ? `${controlId}-description` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const describedBy =
    [props["aria-describedby"], hintId, errorId].filter(Boolean).join(" ") || undefined;
  const Control = clearable || props.type === "search" ? SearchInput : "input";
  const control = (
    <Control
      {...props}
      {...(Control === SearchInput ? { standalone: true } : {})}
      id={controlId}
      ref={ref}
      aria-label={props["aria-label"] ?? (hideLabel && label ? label : undefined)}
      className={[styles.input, endAdornment != null && styles.withEndAdornment, className]
        .filter(Boolean)
        .join(" ")}
      aria-invalid={error ? true : props["aria-invalid"]}
      aria-describedby={describedBy}
    />
  );
  return (
    <div className={[styles.field, fieldClassName].filter(Boolean).join(" ")}>
      {!hideLabel && (
        <label className={styles.label} htmlFor={controlId}>
          {label}
        </label>
      )}
      {endAdornment != null ? (
        <div className={styles.control}>
          {control}
          <div className={styles.endAdornment}>{endAdornment}</div>
        </div>
      ) : (
        control
      )}
      <FieldMessage id={hintId} text={description} className={styles.description} />
      <FieldMessage id={errorId} text={error} className={styles.error} alert />
    </div>
  );
});

Input.displayName = "Input";
