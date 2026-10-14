import { motionTokens as upstreamMotionTokens } from "../motion-tokens";

// The compact workbench uses quiet feedback. Preserve the upstream token file
// so registry updates can be reviewed without losing this local policy.
export const motionTokens = {
  ...upstreamMotionTokens,
  duration: { instant: 0.08, fast: 0.12, exit: 0.16, standard: 0.18, considered: 0.32 },
  spring: {
    ...upstreamMotionTokens.spring,
    snappy: { type: "spring", visualDuration: 0.16, bounce: 0 },
    smooth: { type: "spring", visualDuration: 0.2, bounce: 0 },
    morph: { type: "spring", visualDuration: 0.22, bounce: 0 },
  },
  blur: { subtle: 0, soft: 0, text: 0 },
} as const;
