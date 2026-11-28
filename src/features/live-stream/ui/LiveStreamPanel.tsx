import { useT } from "../../../shared/i18n";
import { FailureState } from "../../../shared/ui/FailureState";
import { InlineError } from "../../../shared/ui/InlineError";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { useLiveStream } from "../hooks/useLiveStream";
import { LiveStreamActivity } from "./LiveStreamActivity";
import { LiveStreamConnection } from "./LiveStreamConnection";
import { LiveGoLive } from "./LiveGoLive";
import { ObsControls } from "./ObsControls";

/** Live streaming controls for this computer, shown as a section of the Social workspace. */
export function LiveStreamPanel() {
  const t = useT();
  const { status, report, live, accounts, feedback } = useLiveStream();
  if (!status.data)
    return status.isError ? (
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
    );
  return (
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
          <LiveGoLive status={status.data} feedback={feedback} live={live} accounts={accounts} />
        </div>
        <LiveStreamActivity status={status.data} report={report} />
      </div>
    </div>
  );
}
