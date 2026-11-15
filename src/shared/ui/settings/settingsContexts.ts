import { createContext } from "react";

export const settingDomId = (id: string) => `setting-${id}`;

/** The row or group Settings just jumped to, so it can flash where you landed. */
export const RevealedSetting = createContext<string | null>(null);

/** Layer editors use secondary subheadings within their parent section. */
export const LayerEditorHeadings = createContext(false);

/** The page already explains automatic saving; keep operation feedback local. */
export const PageAutomaticSaveHint = createContext(false);
