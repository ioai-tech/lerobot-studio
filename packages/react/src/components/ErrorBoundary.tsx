import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { AlertCircle, RotateCcw } from 'lucide-react';
import { Button } from '@ioai/lerobot-studio-ui';

interface Props {
  children?: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-background p-6 text-center">
          <div className="bg-destructive/10 p-4 rounded-full mb-6">
            <AlertCircle className="h-12 w-12 text-destructive" />
          </div>
          <h1 className="text-2xl font-bold mb-2">Something went wrong</h1>
          <p className="text-muted-foreground mb-8 max-w-md mx-auto">
            An unexpected error occurred in the application. We've been notified and are working to
            fix it.
          </p>
          <div className="bg-muted p-4 rounded-lg mb-8 max-w-2xl w-full overflow-auto text-left">
            <p className="font-mono text-xs text-destructive mb-1 font-bold">Error:</p>
            <pre className="font-mono text-xs text-muted-foreground whitespace-pre-wrap">
              {this.state.error?.message || 'Unknown error'}
              {'\n\nStack trace:\n'}
              {this.state.error?.stack}
            </pre>
          </div>
          <Button onClick={this.handleReset} className="flex items-center gap-2">
            <RotateCcw className="h-4 w-4" />
            Reload Application
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}
