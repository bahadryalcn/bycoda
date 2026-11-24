import type { StateField } from "@openuidev/react-lang";
import { createContext, type ReactNode } from "react";
import type {
  VoicePresentedActionButton,
  VoicePresentedActionResponse,
} from "../../../model/voicePresentedActions";
import type { VoiceLiveResult } from "../../../model/voiceLiveWork";

/** What the drawer knows about the last press of one button. */
export type PresentedPress = {
  /** The exact descriptor that was sent; once the owner edits an input it no longer matches. */
  signature: string;
  state: "pending" | "failed" | "sent";
  message?: string;
  response?: VoicePresentedActionResponse;
};

export type PresentedHost = {
  /** Counts each presentation, so a caller can tell which one is on screen. */
  version: number;
  /** The voice turn's observed results; observed components draw only these. */
  observed: readonly VoiceLiveResult[];
  feedback: ReadonlyMap<number, PresentedPress>;
  /** Reports whether the owner may press a button right now. */
  canPress: boolean;
};

export const PresentedHostContext = createContext<PresentedHost>({
  version: 0,
  observed: [],
  feedback: new Map(),
  canPress: false,
});

/** What every component view receives besides its own props. */
export type PresentedViewContext = {
  children?: ReactNode;
  /** The raw child nodes, for components such as Tabs that read a child's props. */
  nodes?: readonly { props?: Record<string, unknown> }[];
  renderNode?: (value: unknown) => ReactNode;
  field?: StateField<unknown>;
};

export type PresentedView = (props: PresentedViewContext & Record<string, unknown>) => ReactNode;

/** Types one view's own props without scattering casts: the spec is the checked contract. */
export const presentedView = <Props extends object>(
  view: (props: Props & PresentedViewContext) => ReactNode,
) => view as unknown as PresentedView;

export type PresentedPressRequest = {
  node: number;
  button: VoicePresentedActionButton;
};
