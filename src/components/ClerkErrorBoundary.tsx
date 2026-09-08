import React from 'react';

export interface ClerkErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export interface ClerkErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ClerkErrorBoundary extends React.Component<ClerkErrorBoundaryProps, ClerkErrorBoundaryState> {
  declare props: ClerkErrorBoundaryProps;
  state: ClerkErrorBoundaryState = {
    hasError: false,
    error: null,
  };

  constructor(props: ClerkErrorBoundaryProps) {
    super(props);
  }

  static getDerivedStateFromError(error: Error): ClerkErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("Clerk UI Error Boundary caught an error:", error, errorInfo);
  }

  handleRetry = () => {
    (this as any).setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback !== undefined) {
        return this.props.fallback;
      }

      return (
        <div className="p-6 bg-red-50/80 rounded-xl border border-red-200 text-center max-w-sm mx-auto my-4 shadow-sm">
          <h3 className="text-sm font-bold text-red-800 mb-1">
            Clerk Authentication UI Error
          </h3>
          <p className="text-xs text-red-600 mb-3 leading-relaxed">
            {this.state.error?.message || "Failed to load authentication component."}
          </p>
          <button
            onClick={this.handleRetry}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-600 text-white text-xs font-semibold rounded shadow hover:bg-red-700 transition-colors"
          >
            Retry Loading
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
