import { z } from "zod";

export const VoiceCompanionViewInput = z.strictObject({
  mode: z.enum(["fullscreen", "window", "mini"]),
});

export const voiceCompanionViewTool = {
  name: "workspace.voice.set_view",
  description:
    "Change the current voice companion view without ending the call. Use fullscreen for a requested full screen or when a visual answer clearly benefits from it. Use window to exit full screen or expand Mini to the normal window. Use mini when the owner asks for Mini or to minimize the companion.",
  parameters: z.toJSONSchema(VoiceCompanionViewInput),
};
