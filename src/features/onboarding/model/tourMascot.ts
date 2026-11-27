/** The guide mascot's poses on a tour card. */
export type TourMascotPose = "wave" | "point" | "think" | "type" | "inspect" | "cheer";

/** A step's own pose, else a greeting on the first card, a cheer on the last, a pointer between. */
export function tourMascotPose(
  pose: TourMascotPose | undefined,
  index: number,
  isLastStep: boolean,
): TourMascotPose {
  if (pose) return pose;
  if (index === 0) return "wave";
  return isLastStep ? "cheer" : "point";
}
