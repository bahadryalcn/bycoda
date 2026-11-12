import { createCrewCanvasRuntime } from "./crewCanvasRuntime";
const receive = createCrewCanvasRuntime((reply) => self.postMessage(reply));
self.onmessage = (event) => receive(event.data);
