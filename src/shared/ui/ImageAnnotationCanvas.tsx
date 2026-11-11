import {
  useEffect,
  useLayoutEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { useT } from "../i18n/technical";
import {
  fitImageAnnotation,
  imageAnnotationArrowHead,
  imageAnnotationPath,
  imageAnnotationPoint,
  MAX_IMAGE_ANNOTATION_MARKS,
  MAX_IMAGE_ANNOTATION_POINTS,
  type ImageAnnotationDocument,
  type ImageAnnotationMark,
  type ImageAnnotationPoint,
  type ImageAnnotationTool,
} from "../lib/imageAnnotations";
import { Button } from "./Button";
import { AlertCircle, ArrowUp, Pencil, Pin, Square, Trash2, Undo2 } from "./icons";
import { MediaToolbar, MediaToolbarButton, type MediaToolbarTone } from "./MediaToolbar";
import "./ImageAnnotationCanvas.css";

export type {
  ImageAnnotationDocument,
  ImageAnnotationMark,
  ImageAnnotationPoint,
  ImageAnnotationTool,
} from "../lib/imageAnnotations";
export { rasterizeImageAnnotations } from "../lib/imageAnnotations";

type Props = {
  src: string;
  alt: string;
  document: ImageAnnotationDocument;
  onChange: (document: ImageAnnotationDocument) => void;
  tool: ImageAnnotationTool;
  disabled?: boolean;
  className?: string;
  /** Fires when a mark starts or ends being drawn, so the owner can show a visible drafting state. */
  onDraftingChange?: (drafting: boolean) => void;
};

const TOOL_ICON: Record<ImageAnnotationTool, (props: { className?: string }) => ReactNode> = {
  box: (props) => <Square {...props} aria-hidden />,
  arrow: (props) => (
    <ArrowUp {...props} className={`${props.className ?? ""} rotate-45`} aria-hidden />
  ),
  pen: (props) => <Pencil {...props} aria-hidden />,
  pin: (props) => <Pin {...props} aria-hidden />,
};

/**
 * The annotation tools on the shared media toolbar family (28px controls, 14px glyphs). The owner keeps the tool,
 * the marks and the undo/clear semantics; this only presents them with pressed state and a visible disabled state.
 * @group media
 * @use The tool, undo and clear controls beside an ImageAnnotationCanvas.
 * @avoid Other media controls: MediaToolbar.
 */
export function ImageAnnotationToolbar({
  tool,
  onToolChange,
  onUndo,
  onClear,
  canUndo = false,
  canClear = false,
  disabled = false,
  tone = "surface",
  labels = {},
  children,
}: {
  tool: ImageAnnotationTool;
  onToolChange: (tool: ImageAnnotationTool) => void;
  onUndo?: () => void;
  onClear?: () => void;
  canUndo?: boolean;
  canClear?: boolean;
  disabled?: boolean;
  tone?: MediaToolbarTone;
  labels?: Partial<Record<ImageAnnotationTool | "toolbar" | "undo" | "clear", string>>;
  /** Owner-specific actions (redo, note, finish...) placed after the standard ones in the same toolbar. */
  children?: ReactNode;
}) {
  const t = useT();
  const text = {
    toolbar: t("Annotation tools"),
    box: t("Box"),
    arrow: t("Arrow"),
    pen: t("Pen"),
    pin: t("Pin"),
    undo: t("Undo last mark"),
    clear: t("Clear marks"),
    ...labels,
  };
  return (
    <MediaToolbar label={text.toolbar} tone={tone}>
      {(["box", "arrow", "pen", "pin"] as const).map((id) => {
        const Icon = TOOL_ICON[id];
        return (
          <MediaToolbarButton
            key={id}
            tone={tone}
            label={text[id]}
            pressed={tool === id}
            disabled={disabled}
            onClick={() => onToolChange(id)}
          >
            <Icon className="icon-sm" />
          </MediaToolbarButton>
        );
      })}
      {onUndo ? (
        <MediaToolbarButton
          tone={tone}
          label={text.undo}
          disabled={disabled || !canUndo}
          onClick={onUndo}
        >
          <Undo2 className="icon-sm" aria-hidden />
        </MediaToolbarButton>
      ) : null}
      {onClear ? (
        <MediaToolbarButton
          tone={tone}
          label={text.clear}
          disabled={disabled || !canClear}
          onClick={onClear}
        >
          <Trash2 className="icon-sm" aria-hidden />
        </MediaToolbarButton>
      ) : null}
      {children}
    </MediaToolbar>
  );
}

/**
 * Drawing surface over a frozen source image: the owner supplies `src`, the `document` of marks and the active `tool`;
 * pointer drawing stays isolated from device input. Reports drafting through `onDraftingChange`.
 * @group media
 * @use Marking up a captured frame or screenshot before sending it.
 * @avoid Viewing an image: ImageLightbox. Comparing two images: ImageLightbox compare mode.
 */
export function ImageAnnotationCanvas({
  src,
  alt,
  document: annotations,
  onChange,
  tool,
  disabled = false,
  className,
  onDraftingChange,
}: Props) {
  const t = useT();
  const container = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const [natural, setNatural] = useState({ width: 0, height: 0 });
  const [available, setAvailable] = useState({ width: 0, height: 0 });
  const [draft, setDraft] = useState<ImageAnnotationMark>();
  const draftRef = useRef<ImageAnnotationMark | undefined>(undefined);
  const activePointer = useRef<number | undefined>(undefined);
  const [cursor, setCursor] = useState<ImageAnnotationPoint>({ x: 0.5, y: 0.5 });
  const [keyboard, setKeyboard] = useState(false);
  // A frame that cannot load shows a readable fallback with Retry; drawing is off and the owner's draft is untouched.
  // Keyed by source and attempt: a load error can arrive before effects run (WebKit), so a
  // mount-time reset must not erase it, and a new source or Retry clears it implicitly.
  const [attempt, setAttempt] = useState(0);
  const [failure, setFailure] = useState<{ src: string; attempt: number }>();
  const failed = failure?.src === src && failure.attempt === attempt;
  const descriptionId = useId();
  const annotationsRef = useRef(annotations);
  useLayoutEffect(() => {
    annotationsRef.current = annotations;
  });
  const fit = fitImageAnnotation(natural.width, natural.height, available.width, available.height);

  const updateDraft = (mark: ImageAnnotationMark | undefined) => {
    const was = draftRef.current !== undefined;
    draftRef.current = mark;
    setDraft(mark);
    if (was !== (mark !== undefined)) onDraftingChange?.(mark !== undefined);
  };
  // A new frame, tool or disabled state drops the in-progress mark (adjusted during render).
  const [draftBasis, setDraftBasis] = useState({ src, tool, disabled });
  if (draftBasis.src !== src || draftBasis.tool !== tool || draftBasis.disabled !== disabled) {
    setDraftBasis({ src, tool, disabled });
    setDraft(undefined);
  }
  useLayoutEffect(() => {
    draftRef.current = undefined;
    activePointer.current = undefined;
    const node = image.current;
    setNatural({
      width: node?.complete ? node.naturalWidth : 0,
      height: node?.complete ? node.naturalHeight : 0,
    });
  }, [src, tool, disabled]);

  useEffect(() => {
    const node = container.current;
    if (!node) return;
    const resize = () => setAvailable({ width: node.clientWidth, height: node.clientHeight });
    resize();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(resize);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const begin = (point: ImageAnnotationPoint) => {
    if (disabled || annotationsRef.current.marks.length >= MAX_IMAGE_ANNOTATION_MARKS) return;
    const id = crypto.randomUUID();
    const pinNumbers = new Set(
      annotationsRef.current.marks.filter((mark) => mark.type === "pin").map((mark) => mark.number),
    );
    let pinNumber = 1;
    while (pinNumbers.has(pinNumber)) pinNumber++;
    const mark: ImageAnnotationMark =
      tool === "pin"
        ? { id, type: "pin", point, number: pinNumber }
        : tool === "pen"
          ? { id, type: "pen", points: [point] }
          : { id, type: tool, start: point, end: point };
    updateDraft(mark);
  };
  const move = (point: ImageAnnotationPoint) => {
    const mark = draftRef.current;
    if (!mark) return;
    if (mark.type === "pen") {
      const last = mark.points[mark.points.length - 1];
      if (
        mark.points.length >= MAX_IMAGE_ANNOTATION_POINTS ||
        Math.hypot(last.x - point.x, last.y - point.y) < 0.001
      )
        return;
      updateDraft({ ...mark, points: [...mark.points, point] });
    } else if (mark.type === "pin") updateDraft({ ...mark, point });
    else updateDraft({ ...mark, end: point });
  };
  const finish = () => {
    const mark = draftRef.current;
    updateDraft(undefined);
    if (!mark || disabled) return;
    if (
      (mark.type === "box" || mark.type === "arrow") &&
      Math.hypot(mark.end.x - mark.start.x, mark.end.y - mark.start.y) < 0.005
    )
      return;
    onChange({ marks: [...annotationsRef.current.marks, mark] });
  };
  const pointerPoint = (event: PointerEvent<SVGSVGElement>) =>
    imageAnnotationPoint(
      { x: event.clientX, y: event.clientY },
      event.currentTarget.getBoundingClientRect(),
    );
  const keyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    if (disabled || event.ctrlKey || event.metaKey || event.altKey) return;
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
      event.preventDefault();
      setKeyboard(true);
      const step = event.shiftKey ? 0.05 : 0.01;
      const point = {
        x: Math.max(
          0,
          Math.min(
            1,
            cursor.x + (event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0),
          ),
        ),
        y: Math.max(
          0,
          Math.min(
            1,
            cursor.y + (event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0),
          ),
        ),
      };
      setCursor(point);
      move(point);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setKeyboard(true);
      if (draftRef.current) finish();
      else {
        begin(cursor);
        if (tool === "pin") finish();
      }
    } else if (event.key === "Escape" && draftRef.current) {
      event.preventDefault();
      event.stopPropagation();
      updateDraft(undefined);
    }
  };
  const width = natural.width || 1;
  const height = natural.height || 1;
  const stroke = Math.min(width, height) * 0.006;
  const allMarks = draft ? [...annotations.marks, draft] : annotations.marks;
  return (
    <div
      ref={container}
      className={["image-annotation-canvas", className].filter(Boolean).join(" ")}
      data-drafting={draft ? "" : undefined}
      aria-busy={draft ? true : undefined}
    >
      {failed ? (
        <div role="alert" className="image-annotation-canvas-fallback">
          <AlertCircle className="icon-md" aria-hidden />
          <span>{t("Preview unavailable. Try again.")}</span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setAttempt((value) => value + 1);
            }}
          >
            {t("Retry")}
          </Button>
        </div>
      ) : (
        <div
          className="image-annotation-canvas-frame"
          style={fit.width ? { width: fit.width, height: fit.height } : undefined}
        >
          <img
            key={attempt}
            ref={image}
            src={src}
            alt={alt}
            draggable={false}
            onError={() => setFailure({ src, attempt })}
            onLoad={(event) =>
              setNatural({
                width: event.currentTarget.naturalWidth,
                height: event.currentTarget.naturalHeight,
              })
            }
          />
          <svg
            className="image-annotation-canvas-layer"
            role="group"
            aria-label={alt}
            aria-describedby={descriptionId}
            aria-disabled={disabled}
            tabIndex={disabled ? -1 : 0}
            viewBox={`0 0 ${width} ${height}`}
            onKeyDown={keyDown}
            onBlur={() => setKeyboard(false)}
            onPointerDown={(event) => {
              if (disabled || event.button !== 0 || activePointer.current !== undefined) return;
              const point = pointerPoint(event);
              if (!point) return;
              event.preventDefault();
              event.stopPropagation();
              event.currentTarget.setPointerCapture?.(event.pointerId);
              activePointer.current = event.pointerId;
              setKeyboard(false);
              begin(point);
            }}
            onPointerMove={(event) => {
              if (activePointer.current !== event.pointerId || disabled) return;
              const point = pointerPoint(event);
              if (point) move(point);
            }}
            onPointerUp={(event) => {
              if (activePointer.current !== event.pointerId) return;
              const point = pointerPoint(event);
              if (point) move(point);
              activePointer.current = undefined;
              finish();
            }}
            onPointerCancel={() => {
              activePointer.current = undefined;
              updateDraft(undefined);
            }}
            onLostPointerCapture={() => {
              if (activePointer.current !== undefined) {
                activePointer.current = undefined;
                updateDraft(undefined);
              }
            }}
          >
            <g
              className="image-annotation-canvas-halo"
              strokeWidth={stroke * 2.4}
              aria-hidden="true"
            >
              {allMarks.map((mark) => (
                <AnnotationMark
                  key={mark.id}
                  mark={mark}
                  width={width}
                  height={height}
                  stroke={stroke}
                  outline
                />
              ))}
            </g>
            <g className="image-annotation-canvas-marks" strokeWidth={stroke}>
              {allMarks.map((mark) => (
                <AnnotationMark
                  key={mark.id}
                  mark={mark}
                  width={width}
                  height={height}
                  stroke={stroke}
                />
              ))}
              {keyboard && (
                <g className="image-annotation-canvas-cursor">
                  <circle cx={cursor.x * width} cy={cursor.y * height} r={stroke * 3} />
                  <path
                    d={`M${cursor.x * width - stroke * 5} ${cursor.y * height}h${stroke * 10}M${cursor.x * width} ${cursor.y * height - stroke * 5}v${stroke * 10}`}
                  />
                </g>
              )}
            </g>
          </svg>
        </div>
      )}
      <span
        id={descriptionId}
        className="image-annotation-canvas-help"
        data-visible={keyboard || undefined}
      >
        {t(
          "Use arrow keys to move. Press Enter to start or finish a mark. Press Escape to cancel.",
        )}
      </span>
    </div>
  );
}

function AnnotationMark({
  mark,
  width,
  height,
  stroke,
  outline = false,
}: {
  mark: ImageAnnotationMark;
  width: number;
  height: number;
  stroke: number;
  outline?: boolean;
}) {
  if (mark.type === "box")
    return (
      <rect
        x={Math.min(mark.start.x, mark.end.x) * width}
        y={Math.min(mark.start.y, mark.end.y) * height}
        width={Math.abs(mark.end.x - mark.start.x) * width}
        height={Math.abs(mark.end.y - mark.start.y) * height}
        rx={stroke}
      />
    );
  if (mark.type === "pin")
    return (
      <g className="image-annotation-canvas-pin">
        <circle
          cx={mark.point.x * width}
          cy={mark.point.y * height}
          r={Math.min(width, height) * 0.027}
        />
        {!outline && (
          <text
            x={mark.point.x * width}
            y={mark.point.y * height}
            fontSize={Math.min(width, height) * 0.028}
          >
            {mark.number}
          </text>
        )}
      </g>
    );
  if (mark.type === "pen")
    return mark.points.length === 1 ? (
      <circle
        className="image-annotation-canvas-dot"
        cx={mark.points[0].x * width}
        cy={mark.points[0].y * height}
        r={stroke * (outline ? 1.2 : 0.5)}
      />
    ) : (
      <path d={imageAnnotationPath(mark.points, width, height)} />
    );
  const head = imageAnnotationArrowHead(mark.start, mark.end, width, height);
  return (
    <g>
      <path d={imageAnnotationPath([mark.start, mark.end], width, height)} />
      <polyline points={head.map((point) => `${point.x},${point.y}`).join(" ")} />
    </g>
  );
}
