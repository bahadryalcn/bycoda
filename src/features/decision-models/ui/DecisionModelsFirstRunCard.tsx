import { Text } from "../../../shared/ui/Text";
import { useEffect, useState } from "react";
import { t } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Heading } from "../../../shared/ui/Heading";
import { Surface } from "../../../shared/ui/Surface";
import type { DecisionModelsClient } from "../model/decisionModelsClient";
import type { LocalRecommendation } from "../model/decisionTypes";
import { localOffer, recommendationText } from "../model/decisionView";

export type DecisionModelsFirstRunCardProps = {
  client: DecisionModelsClient;
  /** Called on "Not now". The caller persists dismissal on its selected Host. */
  onDismiss: () => void;
  /** Opens Providers > Decision models, where the user chooses local install or an API provider. */
  onOpenSettings: () => void;
};

/**
 * One card for Social or automation's first open, sized to this computer. Renders nothing while the
 * recommendation loads or when it cannot be read, so a failed check never adds a nag.
 */
export function DecisionModelsFirstRunCard({
  client,
  onDismiss,
  onOpenSettings,
}: DecisionModelsFirstRunCardProps) {
  const [recommendation, setRecommendation] = useState<LocalRecommendation | null>(null);

  // Load the hardware recommendation only for this card's current client.
  useEffect(() => {
    setRecommendation(null);
    let alive = true;
    void client.local.recommend({}).then(
      (result) => {
        if (alive) setRecommendation(result);
      },
      () => {
        // Unreadable recommendation: stay silent, the Providers section still works.
      },
    );
    return () => {
      alive = false;
    };
  }, [client]);

  if (recommendation === null) return null;
  const offer = localOffer(recommendation);
  return (
    <Surface
      as="section"
      variant="canvas"
      padding="lg"
      aria-label={t("Decision models")}
      className="flex min-w-0 flex-col gap-3"
    >
      <Heading size="item">
        {offer === "install" ? t("Set up a local decision model?") : t("Set up a decision model?")}
      </Heading>
      <Text as="p" size="caption" tone="secondary">
        {recommendationText(recommendation.tier)}
      </Text>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onDismiss}>
          {t("Not now")}
        </Button>
        <Button variant="primary" size="sm" onClick={onOpenSettings}>
          {t("Set up")}
        </Button>
      </div>
    </Surface>
  );
}
