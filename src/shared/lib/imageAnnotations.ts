export type ImageAnnotationPoint = { x: number; y: number };
export type ImageAnnotationTool = "box" | "arrow" | "pen" | "pin";
export type ImageAnnotationMark =
  | { id: string; type: "box" | "arrow"; start: ImageAnnotationPoint; end: ImageAnnotationPoint }
  | { id: string; type: "pen"; points: ImageAnnotationPoint[] }
  | { id: string; type: "pin"; point: ImageAnnotationPoint; number: number };
export type ImageAnnotationDocument = { marks: ImageAnnotationMark[] };

export const MAX_IMAGE_ANNOTATION_MARKS = 250;
export const MAX_IMAGE_ANNOTATION_POINTS = 4000;
export const MAX_ANNOTATED_IMAGE_BYTES = 2 * 1024 * 1024;

/** Coordinates belong to the image, independently of preview scale or letterboxing. */
export function imageAnnotationPoint(
  client: ImageAnnotationPoint,
  bounds: { left: number; top: number; width: number; height: number },
): ImageAnnotationPoint | undefined {
  if (
    ![client.x, client.y, bounds.left, bounds.top, bounds.width, bounds.height].every(
      Number.isFinite,
    ) ||
    bounds.width <= 0 ||
    bounds.height <= 0
  )
    return undefined;
  return {
    x: Math.max(0, Math.min(1, (client.x - bounds.left) / bounds.width)),
    y: Math.max(0, Math.min(1, (client.y - bounds.top) / bounds.height)),
  };
}

export function fitImageAnnotation(
  width: number,
  height: number,
  availableWidth: number,
  availableHeight: number,
) {
  if (
    ![width, height, availableWidth, availableHeight].every(Number.isFinite) ||
    Math.min(width, height, availableWidth, availableHeight) <= 0
  )
    return { width: 0, height: 0 };
  const scale = Math.min(availableWidth / width, availableHeight / height);
  return { width: width * scale, height: height * scale };
}

export function validateImageAnnotationDocument(document: ImageAnnotationDocument): void {
  const point = (value: ImageAnnotationPoint) =>
    value &&
    Number.isFinite(value.x) &&
    Number.isFinite(value.y) &&
    value.x >= 0 &&
    value.x <= 1 &&
    value.y >= 0 &&
    value.y <= 1;
  if (
    !document ||
    !Array.isArray(document.marks) ||
    document.marks.length > MAX_IMAGE_ANNOTATION_MARKS
  )
    throw new Error("Invalid image annotations");
  const ids = new Set<string>();
  for (const mark of document.marks) {
    if (
      !mark ||
      typeof mark.id !== "string" ||
      !mark.id ||
      mark.id.length > 128 ||
      ids.has(mark.id)
    )
      throw new Error("Invalid image annotation identity");
    ids.add(mark.id);
    if (mark.type === "box" || mark.type === "arrow") {
      if (!point(mark.start) || !point(mark.end))
        throw new Error("Invalid image annotation coordinates");
    } else if (mark.type === "pen") {
      if (
        !Array.isArray(mark.points) ||
        !mark.points.length ||
        mark.points.length > MAX_IMAGE_ANNOTATION_POINTS ||
        !mark.points.every(point)
      )
        throw new Error("Invalid image annotation stroke");
    } else if (mark.type === "pin") {
      if (
        !point(mark.point) ||
        !Number.isSafeInteger(mark.number) ||
        mark.number < 1 ||
        mark.number > MAX_IMAGE_ANNOTATION_MARKS
      )
        throw new Error("Invalid image annotation pin");
    } else throw new Error("Invalid image annotation tool");
  }
}

export function imageAnnotationPath(points: ImageAnnotationPoint[], width: number, height: number) {
  return points
    .map((point, index) => `${index ? "L" : "M"}${point.x * width} ${point.y * height}`)
    .join(" ");
}

export function imageAnnotationArrowHead(
  start: ImageAnnotationPoint,
  end: ImageAnnotationPoint,
  width: number,
  height: number,
) {
  const x = end.x * width;
  const y = end.y * height;
  const angle = Math.atan2((end.y - start.y) * height, (end.x - start.x) * width);
  const length = Math.min(width, height) * 0.026;
  return [
    {
      x: x - length * Math.cos(angle - Math.PI / 6),
      y: y - length * Math.sin(angle - Math.PI / 6),
    },
    { x, y },
    {
      x: x - length * Math.cos(angle + Math.PI / 6),
      y: y - length * Math.sin(angle + Math.PI / 6),
    },
  ];
}

export function paintImageAnnotations(
  context: CanvasRenderingContext2D,
  document: ImageAnnotationDocument,
  width: number,
  height: number,
  colors: { stroke: string; pinText: string; outline: string },
) {
  validateImageAnnotationDocument(document);
  context.save();
  const stroke = Math.min(width, height) * 0.006;
  context.lineCap = "round";
  context.lineJoin = "round";
  // Paint contours first so the exact same geometry stays legible over any app content.
  for (const outline of [true, false]) {
    context.strokeStyle = outline ? colors.outline : colors.stroke;
    context.lineWidth = stroke * (outline ? 2.4 : 1);
    for (const mark of document.marks) {
      if (mark.type === "box") {
        context.strokeRect(
          Math.min(mark.start.x, mark.end.x) * width,
          Math.min(mark.start.y, mark.end.y) * height,
          Math.abs(mark.end.x - mark.start.x) * width,
          Math.abs(mark.end.y - mark.start.y) * height,
        );
      } else if (mark.type === "pin") {
        const radius = Math.min(width, height) * 0.027;
        context.fillStyle = outline ? colors.outline : colors.stroke;
        context.beginPath();
        context.arc(
          mark.point.x * width,
          mark.point.y * height,
          radius + (outline ? stroke * 1.2 : 0),
          0,
          2 * Math.PI,
        );
        context.fill();
        if (!outline) {
          context.fillStyle = colors.pinText;
          context.font = `500 ${radius * 1.05}px sans-serif`;
          context.textAlign = "center";
          context.textBaseline = "middle";
          context.fillText(String(mark.number), mark.point.x * width, mark.point.y * height);
        }
      } else {
        const points = mark.type === "pen" ? mark.points : [mark.start, mark.end];
        if (points.length === 1) {
          context.fillStyle = outline ? colors.outline : colors.stroke;
          context.beginPath();
          context.arc(
            points[0].x * width,
            points[0].y * height,
            stroke * (outline ? 1.2 : 0.5),
            0,
            2 * Math.PI,
          );
          context.fill();
          continue;
        }
        context.beginPath();
        points.forEach((point, index) =>
          context[index ? "lineTo" : "moveTo"](point.x * width, point.y * height),
        );
        context.stroke();
        if (mark.type === "arrow") {
          context.beginPath();
          imageAnnotationArrowHead(mark.start, mark.end, width, height).forEach((point, index) =>
            context[index ? "lineTo" : "moveTo"](point.x, point.y),
          );
          context.stroke();
        }
      }
    }
  }
  context.restore();
}

function themeColor(token: string) {
  const probe = document.createElement("span");
  probe.style.color = `var(${token})`;
  probe.hidden = true;
  document.body.append(probe);
  const color = getComputedStyle(probe).color;
  probe.remove();
  return color;
}

/** Renders the selected fixed frame, never a newer live preview or a remote image URL. */
export async function rasterizeImageAnnotations(src: string, annotations: ImageAnnotationDocument) {
  validateImageAnnotationDocument(annotations);
  // An export is bound to the chosen edits even if the owner changes its draft while decoding.
  const snapshot = structuredClone(annotations);
  if (
    typeof src !== "string" ||
    src.length > 64 * 1024 * 1024 ||
    !/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(src)
  )
    throw new Error("Invalid image annotation source");
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const value = new Image();
    value.onload = () => resolve(value);
    value.onerror = () => reject(new Error("Could not load image for annotation"));
    value.src = src;
  });
  if (
    !image.naturalWidth ||
    !image.naturalHeight ||
    image.naturalWidth > 16_384 ||
    image.naturalHeight > 16_384 ||
    image.naturalWidth * image.naturalHeight > 64 * 1024 * 1024
  )
    throw new Error("Invalid image annotation dimensions");
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Image annotation is unavailable");
  const colors = {
    stroke: themeColor("--ui-tone-accent-solid"),
    pinText: themeColor("--ui-tone-accent-on-solid"),
    outline: themeColor("--color-background-base"),
  };
  let scale = Math.min(1, 2048 / Math.max(image.naturalWidth, image.naturalHeight));
  for (let attempt = 0; attempt < 4; attempt++) {
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    paintImageAnnotations(context, snapshot, canvas.width, canvas.height, colors);
    const png = canvas.toDataURL("image/png").split(",")[1];
    if (png && atob(png).length <= MAX_ANNOTATED_IMAGE_BYTES)
      return {
        mime: "image/png" as const,
        base64: png,
        width: canvas.width,
        height: canvas.height,
      };
    const jpeg = canvas.toDataURL("image/jpeg", 0.86).split(",")[1];
    if (jpeg && atob(jpeg).length <= MAX_ANNOTATED_IMAGE_BYTES)
      return {
        mime: "image/jpeg" as const,
        base64: jpeg,
        width: canvas.width,
        height: canvas.height,
      };
    scale *= 0.75;
  }
  throw new Error("The annotated image is too large to add to the draft");
}
