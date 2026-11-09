import {
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
  type Ref,
  type TextareaHTMLAttributes,
} from "react";
import { fitTextareaHeight } from "./arc/textarea/textarea";
import styles from "./PromptField.module.css";

type FrameProps = HTMLAttributes<HTMLDivElement> & {
  ref?: Ref<HTMLDivElement>;
  [data: `data-${string}`]: string | undefined;
};

export type PromptFieldProps = Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  "children" | "aria-label"
> & {
  /** Accessible name. Prompt surfaces have no visible label; the surrounding section or placeholder gives context. */
  label: string;
  ref?: Ref<HTMLTextAreaElement>;
  /** Grow with the content between `minRows` and `maxRows`/`maxHeight`. Defaults to true. */
  autosize?: boolean;
  /** Smallest height in lines (default 3). */
  minRows?: number;
  /** Tallest height in lines before the editor scrolls. */
  maxRows?: number;
  /** Tallest height in pixels, for owners that cap by layout (the composer's 160px) instead of lines. */
  maxHeight?: number;
  /** `body` (default) for forms and panels; `secondary` for dense editors; `title` for the large standalone composer. */
  textSize?: "secondary" | "body" | "title";
  monospace?: boolean;
  /** Bordered surface of the frame: `default` is the panel surface, `raised` the raised form surface. */
  surface?: "default" | "raised";
  /**
   * Mirror layer drawn behind a transparent editor (skill, mode and mention highlighting). It shares the
   * editor's box and typography, is hidden from assistive tech, and follows the editor's scroll.
   */
  overlay?: ReactNode;
  overlayRef?: Ref<HTMLDivElement>;
  /** Rows inside the frame above the editor (attachments, chips, context). */
  header?: ReactNode;
  /** Toolbar row below the editor: pickers and toggles at the start, primary actions at the end. */
  toolbarLeading?: ReactNode;
  toolbarTrailing?: ReactNode;
  /** Popovers and anchors that belong to the editor; positioned against the editor box. */
  children?: ReactNode;
  /**
   * Inset of the text inside the editor, as CSS lengths. Unset sides keep the default; the mirror
   * overlay shares it. For asymmetric room (a close button at the end, a taller top).
   */
  inset?: { blockStart?: string; blockEnd?: string; inlineStart?: string; inlineEnd?: string };
  /** Indent of the first line (a leading mode icon drawn by the overlay). Shared with the overlay. */
  indent?: string;
  /** Fill the parent's height instead of sizing to rows: the editor scrolls inside the box. Use with `autosize={false}`. */
  fill?: boolean;
  /**
   * Who draws the focus ring. `group` (default) lets the bordered ancestor show it. `input` is for a
   * `framed={false}` editor that is a standalone surface and owns its own focus state.
   */
  focus?: "group" | "input";
  /** Keep the frame boundary but draw no focus ring (main composer). */
  quiet?: boolean;
  /**
   * `false` when an ancestor already is the bordered `data-ui-focus-group` (a window-sized composer).
   * The editor then keeps `data-ui-focus="group"` and draws no frame of its own.
   */
  framed?: boolean;
  frameClassName?: string;
  /** Extra attributes and handlers for the frame (drop targets, `data-*` hooks, ref). */
  frameProps?: FrameProps;
  editorClassName?: string;
};

/**
 * Borderless, autosizing prompt/editor inside one bordered frame that owns the single focus ring.
 * Slots: `header` (chips, attachments), `overlay` (highlight mirror), `children` (anchored popovers),
 * `toolbarLeading`/`toolbarTrailing`. `quiet` gives the composer look; `framed={false}` when the owner is the frame.
 * `inset` and `indent` tune the text box (the overlay follows), `fill` takes the parent's height with `framed={false}`.
 * All textarea props, events and the ref pass through, so pickers, IME guards and drafts stay with the owner.
 * @group fields
 * @use Multi-line prompt or editor with a toolbar, attachments or highlighting (queued message edit, automation prompt).
 * @avoid Ordinary labeled multi-line form field: TextareaField. Single line: Input.
 */
export function PromptField({
  label,
  ref,
  autosize = true,
  minRows = 3,
  maxRows,
  maxHeight,
  textSize = "body",
  monospace = false,
  inset,
  indent,
  fill = false,
  focus = "group",
  surface = "default",
  overlay,
  overlayRef,
  header,
  toolbarLeading,
  toolbarTrailing,
  children,
  quiet = false,
  framed = true,
  frameClassName,
  frameProps,
  editorClassName,
  className,
  style,
  rows,
  onScroll,
  onInput,
  ...props
}: PromptFieldProps) {
  const field = useRef<HTMLTextAreaElement>(null);
  const mirror = useRef<HTMLDivElement>(null);
  useImperativeHandle(ref, () => field.current!, []);
  useImperativeHandle(overlayRef, () => mirror.current!, []);
  const fit = useCallback(() => {
    if (autosize && field.current) fitTextareaHeight(field.current);
  }, [autosize]);
  useLayoutEffect(fit, [fit, props.value, minRows, maxRows, maxHeight, textSize, monospace]);
  useLayoutEffect(() => {
    const node = field.current;
    if (!autosize || !node || typeof ResizeObserver === "undefined") return;
    // Pane resizing rewraps the draft; height-only observations come from the fit itself.
    let width = node.clientWidth;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      if (node.clientWidth === width) return;
      width = node.clientWidth;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => fitTextareaHeight(node));
    });
    observer.observe(node);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [autosize]);

  const editorStyle: CSSProperties & Record<`--${string}`, string | number> = { ...style };
  editorStyle["--prompt-min-rows"] = minRows;
  if (maxRows) editorStyle["--prompt-max-rows"] = maxRows;
  if (maxHeight) editorStyle.maxHeight = maxHeight;
  const frameStyle: CSSProperties & Record<`--${string}`, string> = {};
  if (inset?.blockStart) frameStyle["--prompt-pad-block-start"] = inset.blockStart;
  if (inset?.blockEnd) frameStyle["--prompt-pad-block-end"] = inset.blockEnd;
  if (inset?.inlineStart) frameStyle["--prompt-pad-inline-start"] = inset.inlineStart;
  if (inset?.inlineEnd) frameStyle["--prompt-pad-inline-end"] = inset.inlineEnd;
  if (indent) frameStyle["--prompt-indent"] = indent;
  const toolbar =
    toolbarLeading != null || toolbarTrailing != null ? (
      <div className={styles.toolbar} data-prompt-toolbar="">
        <div className={styles.toolbarLeading}>{toolbarLeading}</div>
        {toolbarTrailing != null ? (
          <div className={styles.toolbarTrailing}>{toolbarTrailing}</div>
        ) : null}
      </div>
    ) : null;

  const body = (
    <>
      {header}
      <div
        className={styles.editor}
        data-text-size={textSize}
        data-monospace={monospace ? "" : undefined}
        data-fill={fill ? "" : undefined}
        style={frameStyle}
      >
        {children}
        {overlay != null ? (
          <div ref={mirror} aria-hidden className={styles.mirror}>
            {overlay}
          </div>
        ) : null}
        <textarea
          {...props}
          ref={field}
          rows={rows ?? minRows}
          aria-label={label}
          data-ui-focus={focus}
          data-prompt-editor=""
          data-fill={fill ? "" : undefined}
          data-prompt-mirrored={overlay != null ? "" : undefined}
          data-max-rows={maxRows ? "" : undefined}
          data-autosize={autosize ? "" : undefined}
          style={editorStyle}
          onInput={(event) => {
            onInput?.(event);
            if (props.value === undefined) fit();
          }}
          onScroll={(event) => {
            onScroll?.(event);
            if (mirror.current) mirror.current.scrollTop = event.currentTarget.scrollTop;
          }}
          className={[styles.input, editorClassName, className].filter(Boolean).join(" ")}
        />
      </div>
      {toolbar}
    </>
  );

  if (!framed) {
    return (
      <div
        {...frameProps}
        data-prompt-field=""
        data-fill={fill ? "" : undefined}
        className={[styles.bare, frameProps?.className, frameClassName].filter(Boolean).join(" ")}
      >
        {body}
      </div>
    );
  }
  return (
    <div
      {...frameProps}
      data-prompt-field=""
      data-ui-focus-group=""
      data-ui-focus-quiet={quiet ? "" : undefined}
      data-surface={surface}
      data-fill={fill ? "" : undefined}
      data-disabled={props.disabled ? "" : undefined}
      className={[styles.frame, frameProps?.className, frameClassName].filter(Boolean).join(" ")}
    >
      {body}
    </div>
  );
}
