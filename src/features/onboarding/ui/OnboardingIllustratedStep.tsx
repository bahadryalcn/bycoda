import type { ReactNode } from "react";
import guideTip from "../../../assets/onboarding/guide-tip.webp";
import guideTipStill from "../../../assets/onboarding/guide-tip-still.webp?no-inline";
import connectComputer from "../../../assets/onboarding/connect-computer.webp";
import connectComputerStill from "../../../assets/onboarding/connect-computer-still.webp?no-inline";
import { useDecorativeMotionEnabled } from "../../settings/public/decorativeMotion";

// Desktop exports of the mobile setup guide and connect-computer artwork.
const scenes = {
  account: { animated: guideTip, still: guideTipStill, width: 135, height: 240 },
  connections: { animated: connectComputer, still: connectComputerStill, width: 240, height: 184 },
};

export function OnboardingIllustratedStep({
  scene,
  children,
}: {
  scene: keyof typeof scenes;
  children: ReactNode;
}) {
  const motion = useDecorativeMotionEnabled();
  const { animated, still, width, height } = scenes[scene];
  return (
    <div className="onboarding-scroll">
      <div className="onboarding-illustrated-step">
        <div className="min-w-0">{children}</div>
        <img src={motion ? animated : still} alt="" width={width} height={height} />
      </div>
    </div>
  );
}
