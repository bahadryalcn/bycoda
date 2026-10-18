import { Component, Fragment, type ReactNode } from "react";
import { t } from "../i18n";
import { Button } from "./Button";
import { FailureState, isModuleLoadError } from "./FailureState";

/** Rendering and lazy-import failures recover locally; never reset stored workspace data. */
export class RecoveryBoundary extends Component<
  {
    children: ReactNode;
    fullScreen?: boolean;
    onBack?: () => void;
  },
  { failed: boolean; error: unknown; attempt: number }
> {
  state = { failed: false, error: undefined as unknown, attempt: 0 };

  static getDerivedStateFromError(error: unknown) {
    return { failed: true, error };
  }

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
        onRetry={() =>
          moduleError
            ? window.location.reload()
            : this.setState(({ attempt }) => ({
                failed: false,
                error: undefined,
                attempt: attempt + 1,
              }))
        }
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
