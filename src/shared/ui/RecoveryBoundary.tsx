import { Component, Fragment, type ErrorInfo, type ReactNode } from "react";
import { t } from "../i18n";
import { Button } from "./Button";
import { FailureState, isModuleLoadError } from "./FailureState";

export const LAST_RENDER_ERROR_KEY = "bycoda.diagnostics.lastRenderError";
const LAST_RENDER_ERROR_MAX_CHARS = 8000;

/** Keeps the newest render failure so a release build without component names stays diagnosable. */
function recordRenderError(error: unknown, componentStack: string) {
  try {
    const message = error instanceof Error ? error.message : String(error ?? "");
    const record = JSON.stringify({
      message: message.slice(0, 1000),
      componentStack: componentStack.slice(0, LAST_RENDER_ERROR_MAX_CHARS - 1500),
      at: new Date().toISOString(),
    });
    localStorage.setItem(LAST_RENDER_ERROR_KEY, record.slice(0, LAST_RENDER_ERROR_MAX_CHARS));
  } catch {
    // Storage can be unavailable or full; diagnostics never block recovery.
  }
}

function keysChanged(previous: readonly unknown[] = [], next: readonly unknown[] = []) {
  return (
    previous.length !== next.length ||
    previous.some((value, index) => !Object.is(value, next[index]))
  );
}

/**
 * Error boundary for a pane or route: catches render and lazy-import failures and shows a FailureState with retry.
 * Recovery stays local and never resets stored workspace data; `resetKeys` remount the view when the route or record changes.
 * `onError` reports, `onReset` runs after recovery, `onBack` adds a back action, `fullScreen` fills the window.
 * @group feedback
 * @use Wrap a pane, tab or lazily loaded view so one crash does not take down the workspace.
 * @avoid Expected failures (request, validation): show Alert or FailureState inline. It does not catch event-handler errors.
 */
export class RecoveryBoundary extends Component<
  {
    children: ReactNode;
    fullScreen?: boolean;
    onBack?: () => void;
    /** When any value changes while the view is failed, the boundary remounts the view, for example after the route or record it shows changed. */
    resetKeys?: readonly unknown[];
    /** Reports the caught error so the owner can record it. Never required for recovery. */
    onError?: (error: unknown, info: ErrorInfo) => void;
    /** Runs after the boundary left the failed state, by retry or by a reset key. */
    onReset?: () => void;
  },
  { failed: boolean; error: unknown; attempt: number; componentStack: string }
> {
  override state = { failed: false, error: undefined as unknown, attempt: 0, componentStack: "" };

  static getDerivedStateFromError(error: unknown) {
    return { failed: true, error };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo) {
    const componentStack = info.componentStack ?? "";
    this.setState({ componentStack });
    recordRenderError(error, componentStack);
    this.props.onError?.(error, info);
  }

  override componentDidUpdate(previous: { resetKeys?: readonly unknown[] }) {
    if (this.state.failed && keysChanged(previous.resetKeys, this.props.resetKeys)) this.reset();
  }

  private reset = () => {
    this.setState(({ attempt }) => ({
      failed: false,
      error: undefined,
      attempt: attempt + 1,
      componentStack: "",
    }));
    this.props.onReset?.();
  };

  override render() {
    if (!this.state.failed)
      return <Fragment key={this.state.attempt}>{this.props.children}</Fragment>;
    const moduleError = isModuleLoadError(this.state.error);
    const { error, componentStack } = this.state;
    // Details and Copy details carry the component stack so a bug report shows where it failed.
    const detailed =
      componentStack && error instanceof Error
        ? new Error(`${error.message}

Component stack:${componentStack}`)
        : error;
    return (
      <FailureState
        fullScreen={this.props.fullScreen}
        title={t("This view could not be displayed")}
        description={
          moduleError
            ? t(
                "An application module could not be loaded. Reload the app to get the latest files.",
              )
            : t("An unexpected error interrupted this view. Try opening it again.")
        }
        error={detailed}
        retryLabel={moduleError ? t("Reload app") : t("Try again")}
        onRetry={() => (moduleError ? window.location.reload() : this.reset())}
        secondaryAction={
          this.props.onBack ? (
            <Button motion="none" onClick={this.props.onBack}>
              {t("Back to workspace")}
            </Button>
          ) : !moduleError ? (
            <Button motion="none" onClick={() => window.location.reload()}>
              {t("Reload app")}
            </Button>
          ) : undefined
        }
      />
    );
  }
}
