import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { t } from "../i18n/technical";
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
};

/** Drawing is isolated from device input; the owner supplies a frozen source frame. */
export function ImageAnnotationCanvas({
  src,
  alt,
  document: annotations,
  onChange,
  tool,
  disabled = false,
  className,
}: Props) {
  const container = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const [natural, setNatural] = useState({ width: 0, height: 0 });
  const [available, setAvailable] = useState({ width: 0, height: 0 });
  const [draft, setDraft] = useState<ImageAnnotationMark>();
  const draftRef = useRef<ImageAnnotationMark | undefined>(undefined);
  const activePointer = useRef<number | undefined>(undefined);
  const [cursor, setCursor] = useState<ImageAnnotationPoint>({ x: 0.5, y: 0.5 });
  const [keyboard, setKeyboard] = useState(false);
  const descriptionId = useId();
  const annotationsRef = useRef(annotations);
  annotationsRef.current = annotations;
  const fit = fitImageAnnotation(natural.width, natural.height, available.width, available.height);

  const updateDraft = (mark: ImageAnnotationMark | undefined) => {
    draftRef.current = mark;
    setDraft(mark);
  };
  useEffect(() => {
    setDraft(undefined);
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
    >
      <div
        className="image-annotation-canvas-frame"
        style={fit.width ? { width: fit.width, height: fit.height } : undefined}
      >
        <img
          ref={image}
          src={src}
          alt={alt}
          draggable={false}
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
          <g className="image-annotation-canvas-halo" strokeWidth={stroke * 2.4} aria-hidden="true">
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
      <span id={descriptionId} className="image-annotation-canvas-help">
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
