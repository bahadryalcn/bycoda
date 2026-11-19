import type { ReactNode } from "react";
import { useT } from "../../../shared/i18n";
import { FailureState } from "../../../shared/ui/FailureState";
import { InlineError } from "../../../shared/ui/InlineError";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { PaneHeader } from "../../../shared/ui/PaneHeader";
import { Surface } from "../../../shared/ui/Surface";
import { CircleDot } from "../../../shared/ui/icons";
import { useLiveStream } from "../hooks/useLiveStream";
import { LiveStreamActivity } from "./LiveStreamActivity";
import { LiveStreamConnection } from "./LiveStreamConnection";
import { LiveGoLive } from "./LiveGoLive";
import { ObsControls } from "./ObsControls";

export function LiveStreamPage({
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
  const { status, report, live, accounts, feedback } = useLiveStream();
  return (
    <Surface variant="canvas" className="flex min-h-0 min-w-0 flex-1 flex-col">
      <PaneHeader
        chromeInset={chromeInset}
        dragRegion
        leading={leading}
        trailing={trailing}
        title={navigation ? undefined : t("Live streaming")}
        icon={navigation ? undefined : <CircleDot />}
      >
        {navigation}
      </PaneHeader>
      {!status.data ? (
        status.isError ? (
          <FailureState
            context="page"
            title={t("Could not load live streaming")}
            error={status.error}
            onRetry={async () => {
              await status.refetch();
            }}
          />
        ) : (
          <LoadingText layout="fill" />
        )
      ) : (
        <div className="@container min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto grid max-w-6xl gap-6 px-4 py-5 @min-[830px]:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] @min-[830px]:px-6">
            {status.isError ? (
              <InlineError className="col-span-full" details={status.error.message}>
                {t("Could not refresh live streaming")}
              </InlineError>
            ) : null}
            <div className="flex min-w-0 flex-col gap-4">
              <LiveStreamConnection status={status.data} feedback={feedback} />
              <ObsControls status={status.data} feedback={feedback} live={live} />
              <LiveGoLive
                status={status.data}
                feedback={feedback}
                live={live}
                accounts={accounts}
              />
            </div>
            <LiveStreamActivity status={status.data} report={report} />
          </div>
        </div>
      )}
    </Surface>
  );
}
