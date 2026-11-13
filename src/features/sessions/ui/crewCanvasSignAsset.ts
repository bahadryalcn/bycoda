import source from "../../../../public/brand/bycoda/logo-horizontal-white.svg?raw";
import { themePalette } from "../../../shared/theme/palette";

export type SignPath = {
  path: string;
  matrix: number[];
  fill: string;
  stroke: string;
  width: number;
};

/** Read the owned logo's paths once; workers have no SVG DOM or document fonts. */
export function prepareSignPaths(): SignPath[] {
  const root = new DOMParser().parseFromString(source, "image/svg+xml").documentElement;
  const paths: SignPath[] = [];
  const visit = (
    element: Element,
    parent: DOMMatrix,
    inherited: Omit<SignPath, "path" | "matrix">,
  ) => {
    if (!["svg", "g", "path"].includes(element.tagName))
      throw new Error("Unsupported crew logo element");
    const transform = (element as SVGGraphicsElement).transform?.baseVal.consolidate()?.matrix;
    const matrix = transform ? parent.multiply(transform) : parent;
    const style = {
      fill: element.getAttribute("fill") ?? inherited.fill,
      stroke: element.getAttribute("stroke") ?? inherited.stroke,
      width: Number(element.getAttribute("stroke-width") ?? inherited.width),
    };
    if (element.tagName === "path")
      paths.push({
        ...style,
        path: element.getAttribute("d") ?? "",
        matrix: [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f],
      });
    for (const child of element.children) visit(child, matrix, style);
  };
  visit(root, new DOMMatrix(), { fill: themePalette.svgDefaultFill, stroke: "none", width: 1 });
  return paths;
}

export function createSignPaths(paths: SignPath[]) {
  const prepared = paths.map((path) => ({ ...path, shape: new Path2D(path.path) }));
  return (
    context: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
  ) => {
    context.save();
    context.translate(x, y);
    context.scale(width / 390, height / 80);
    context.lineCap = "round";
    context.lineJoin = "round";
    for (const path of prepared) {
      context.save();
      const [a, b, c, d, e, f] = path.matrix;
      context.transform(a, b, c, d, e, f);
      if (path.fill !== "none") {
        context.fillStyle = path.fill;
        context.fill(path.shape);
      }
      if (path.stroke !== "none") {
        context.strokeStyle = path.stroke;
        context.lineWidth = path.width;
        context.stroke(path.shape);
      }
      context.restore();
    }
    context.restore();
  };
}
