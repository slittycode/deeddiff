import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallbackLabel?: string;
}
interface State {
  error: Error | null;
}

/** Keeps a WASM/viewer crash from white-screening the whole app. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("ErrorBoundary caught:", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="error-pane">
          <h3>{this.props.fallbackLabel ?? "Something went wrong"}</h3>
          <pre>{this.state.error.message}</pre>
          <button onClick={() => this.setState({ error: null })}>Dismiss</button>
        </div>
      );
    }
    return this.props.children;
  }
}
