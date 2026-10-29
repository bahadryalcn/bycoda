"use client";

import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { motionTokens } from "./motion-tokens";
import styles from "./field-message.module.css";

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

/** The grid track reveals the natural message height, so a longer wrapped message opens its next line without a measurement observer. */
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

/**
 * The one helper/error message renderer for Input, Textarea and TagInput. `className` styles the copy
 * (color, padding); `alert` makes the copy the field's single `role="alert"` live region. Pair `id` with
 * `fieldMessageIds`/`fieldDescribedBy` so the control describes itself by this element.
 */
export function FieldMessage({
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
