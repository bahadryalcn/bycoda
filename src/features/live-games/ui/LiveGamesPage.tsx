import type { ReactNode } from "react";
import { useT } from "../../../shared/i18n";
import { Divider } from "../../../shared/ui/Divider";
import { FailureState } from "../../../shared/ui/FailureState";
import { InlineError } from "../../../shared/ui/InlineError";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { PaneHeader } from "../../../shared/ui/PaneHeader";
import { Surface } from "../../../shared/ui/Surface";
import { CircleDot } from "../../../shared/ui/icons";
import { useLiveGames } from "../hooks/useLiveGames";
import { HalayControls, HalayRules } from "./HalayControls";
import { LiveGameActivity } from "./LiveGameActivity";
import { LiveGameConnection } from "./LiveGameConnection";
import { ObsControls } from "./ObsControls";

export function LiveGamesPage({
  chromeInset,
  leading,
  trailing,
  navigation,
}: {
  chromeInset?: boolean | "compact";
  leading?: ReactNode;
  trailing?: ReactNode;
  navigation?: ReactNode;
}) {
  const t = useT();
  const { status, report, feedback } = useLiveGames();
  return (
    <Surface variant="canvas" className="flex min-h-0 min-w-0 flex-1 flex-col">
      <PaneHeader
        chromeInset={chromeInset}
        dragRegion
        leading={leading}
        trailing={trailing}
        title={navigation ? undefined : t("Live games")}
        icon={navigation ? undefined : <CircleDot />}
      >
        {navigation}
      </PaneHeader>
      {!status.data ? (
        status.isError ? (
          <FailureState
            context="page"
            title={t("Could not load live games")}
            error={status.error}
            onRetry={async () => { await status.refetch(); }}
          />
        ) : (
          <LoadingText layout="fill" />
        )
      ) : (
        <div className="@container min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto grid max-w-6xl gap-6 px-4 py-5 @min-[830px]:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] @min-[830px]:px-6">
            {status.isError ? (
              <InlineError className="col-span-full" details={status.error.message}>
                {t("Could not refresh live games")}
              </InlineError>
            ) : null}
            <div className="flex min-w-0 flex-col gap-4">
              <LiveGameConnection status={status.data} feedback={feedback} />
              <Divider />
              <ObsControls status={status.data} feedback={feedback} />
              <Divider />
              <HalayControls config={status.data.config} feedback={feedback} />
              <HalayRules rules={status.data.config.giftRules} feedback={feedback} />
            </div>
            <LiveGameActivity status={status.data} report={report} />
          </div>
        </div>
      )}
    </Surface>
  );
}
