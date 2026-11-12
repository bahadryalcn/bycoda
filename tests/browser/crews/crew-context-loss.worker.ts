import { createCrewCanvasRuntime } from "../../../src/features/sessions/ui/crewCanvasRuntime";
const getContext = OffscreenCanvas.prototype.getContext;
let gpu: WebGLRenderingContext | undefined;
OffscreenCanvas.prototype.getContext = function (
  this: OffscreenCanvas,
  ...args: Parameters<typeof getContext>
) {
  const context = getContext.apply(this, args);
  if (args[0] === "webgl" && context) gpu = context as WebGLRenderingContext;
  return context;
} as typeof getContext;
const receive = createCrewCanvasRuntime((reply) => self.postMessage(reply));
self.onmessage = ({ data }) => {
  if (data.type === "test-lose-webgl") {
    const extension = gpu?.getExtension("WEBGL_lose_context");
    if (!extension) throw new Error("Context loss extension unavailable");
    extension.loseContext();
    self.postMessage({ type: "test-lost", lost: gpu!.isContextLost() });
  } else receive(data);
};
