import babel from "@rolldown/plugin-babel";
import { reactCompilerPreset } from "@vitejs/plugin-react";
import type { Logger } from "babel-plugin-react-compiler";
import { reactCompilerGuard } from "./reactCompilerGuard";

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

const WORKERS = /(?:[\\/]workers?[\\/]|\.worker\.[jt]sx?$)/;
const NODE_MODULES = /[\\/]node_modules[\\/]/;
/** Compiled in full ("infer"): their render paths are pure and they are reused everywhere. */
const INFERRED = /[\\/]src[\\/]shared[\\/]ui[\\/].*\.[jt]sx?$/;

function compilerPass(include: RegExp, exclude: RegExp[], compilationMode: "infer" | "annotation") {
  return babel({
    include,
    exclude,
    // Runs first: marks functions that read state the compiler cannot see "use no memo".
    plugins: [reactCompilerGuard({ annotation: compilationMode === "annotation" })],
    presets: [
      reactCompilerPreset({
        compilationMode,
        logger: { logEvent: reportDiagnostics },
      }),
    ],
  });
}

/** Shared UI is compiled in full; elsewhere only functions marked "use memo" are,
 * until each area is checked for render-time reads of external state. */
export function reactCompiler() {
  return [
    compilerPass(INFERRED, [NODE_MODULES, WORKERS], "infer"),
    compilerPass(/[\\/]src[\\/].*\.[jt]sx?$/, [NODE_MODULES, WORKERS, INFERRED], "annotation"),
  ];
}
