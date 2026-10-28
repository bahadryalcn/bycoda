import { Component, Fragment, type ErrorInfo, type ReactNode } from "react";
import { t } from "../i18n";
import { Button } from "./Button";
import { FailureState, isModuleLoadError } from "./FailureState";

function keysChanged(previous: readonly unknown[] = [], next: readonly unknown[] = []) {
  return (
    previous.length !== next.length ||
    previous.some((value, index) => !Object.is(value, next[index]))
  );
}

/**
 * Rendering and lazy-import failures recover locally; never reset stored workspace data.
 * The failed view shows a visible title, the recovery action and the diagnostic.
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
  { failed: boolean; error: unknown; attempt: number }
> {
  state = { failed: false, error: undefined as unknown, attempt: 0 };

  static getDerivedStateFromError(error: unknown) {
    return { failed: true, error };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    this.props.onError?.(error, info);
  }

  componentDidUpdate(previous: { resetKeys?: readonly unknown[] }) {
    if (this.state.failed && keysChanged(previous.resetKeys, this.props.resetKeys)) this.reset();
  }

  private reset = () => {
    this.setState(({ attempt }) => ({ failed: false, error: undefined, attempt: attempt + 1 }));
    this.props.onReset?.();
  };

  render() {
    if (!this.state.failed)
      return <Fragment key={this.state.attempt}>{this.props.children}</Fragment>;
    const moduleError = isModuleLoadError(this.state.error);
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
        error={this.state.error}
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
