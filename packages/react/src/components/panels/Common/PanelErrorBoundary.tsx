import React, { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { Button } from '@ioai/lerobot-studio-ui';

interface Props {
  children: ReactNode;
  panelName?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
  retryKey: number;
}

/**
 * 面板级错误边界组件
 * 用于隔离单个面板的错误，防止影响整个应用
 */
export class PanelErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    retryKey: 0,
  };

  public static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(
      `[PanelErrorBoundary] Error in ${this.props.panelName || 'panel'}:`,
      error,
      errorInfo,
    );
  }

  private handleRetry = () => {
    this.setState((prev) => ({
      hasError: false,
      error: null,
      retryKey: prev.retryKey + 1,
    }));
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-full w-full bg-background p-4 text-center">
          <div className="bg-destructive/10 p-3 rounded-full mb-4">
            <AlertTriangle className="h-6 w-6 text-destructive" />
          </div>
          <h3 className="text-sm font-semibold mb-1">
            {this.props.panelName ? `${this.props.panelName} 加载失败` : '面板加载失败'}
          </h3>
          <p className="text-xs text-muted-foreground mb-4 max-w-[200px]">
            发生了意外错误，其他面板不受影响
          </p>
          <div className="bg-muted/50 p-2 rounded text-left mb-4 max-w-full overflow-auto">
            <pre className="font-mono text-[10px] text-destructive/80 whitespace-pre-wrap break-all">
              {this.state.error?.message || 'Unknown error'}
            </pre>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={this.handleRetry}
            className="flex items-center gap-1.5 text-xs"
          >
            <RotateCcw className="h-3 w-3" />
            重试
          </Button>
        </div>
      );
    }

    return <React.Fragment key={this.state.retryKey}>{this.props.children}</React.Fragment>;
  }
}
