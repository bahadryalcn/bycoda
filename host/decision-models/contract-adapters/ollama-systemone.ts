import { createSystemOneAdapter } from "./systemone";

// shortcut: the Ollama /api/systemone route and layout are contract assumptions (D13), not checked against a
// running Ollama. The System One layout is reused until that is verified.
export const ollamaSystemOneAdapter = createSystemOneAdapter("ollama-systemone");
