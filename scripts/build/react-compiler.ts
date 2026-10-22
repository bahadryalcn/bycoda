import babel from "@rolldown/plugin-babel";
import { reactCompilerPreset } from "@vitejs/plugin-react";
import type { Logger } from "babel-plugin-react-compiler";

// Babel Compiler 1.0 exposes diagnostics through logger; reportDiagnostics is
// an option of the native OXC compiler, which this pipeline does not use.
const reportDiagnostics: Logger["logEvent"] = (filename, event) => {
  if (event.kind === "CompileError" || event.kind === "CompileDiagnostic") {
    const detail = event.detail;
    console.warn(`[react-compiler] ${filename}:${event.fnLoc?.start.line ?? 0} ${detail.reason}`);
  } else if (event.kind === "CompileSkip") {
    console.warn(`[react-compiler] ${filename}:${event.fnLoc?.start.line ?? 0} ${event.reason}`);
  } else if (event.kind === "PipelineError") {
    console.warn(`[react-compiler] ${filename}: ${event.data}`);
  }
};

export function reactCompiler() {
  return babel({
    include: /[\\/]src[\\/].*\.[jt]sx?$/,
    exclude: [/[\\/]node_modules[\\/]/, /(?:[\\/]workers?[\\/]|\.worker\.[jt]sx?$)/],
    presets: [
      reactCompilerPreset({
        compilationMode: "annotation",
        logger: { logEvent: reportDiagnostics },
      }),
    ],
  });
}
