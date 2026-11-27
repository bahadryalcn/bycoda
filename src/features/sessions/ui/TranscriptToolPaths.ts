import { createContext } from "react";

/**
 * Files the transcript's tools touched, read when a file link is clicked.
 * Bare names in the agent's prose resolve beside them before the project root.
 */
export const TranscriptToolPaths = createContext<(() => readonly string[]) | undefined>(undefined);
