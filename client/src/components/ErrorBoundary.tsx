import { Component, ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error("ErrorBoundary caught:", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#0d1117] flex items-center justify-center p-8">
          <div className="max-w-lg text-center">
            <p className="text-sky-400 font-mono text-sm mb-2">
              RUNTIME ERROR
            </p>
            <h1 className="text-white text-2xl font-bold mb-4">
              Something went wrong
            </h1>
            <pre className="text-left bg-[#161b22] border border-[#30363d] rounded-lg p-4 text-red-400 text-xs overflow-auto mb-6">
              {this.state.error?.message}
            </pre>
            <button
              onClick={() =>
                this.setState({ hasError: false, error: null })
              }
              className="bg-sky-500 hover:bg-sky-400 text-white px-6 py-2 rounded-lg font-medium transition-colors"
            >
              Try again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
