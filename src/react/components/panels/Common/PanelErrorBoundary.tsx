import React, { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { Button } from '@/ui';
import { useTranslation } from 'react-i18next';

interface Props {
  children: ReactNode;
  panelName?: string;
  renderFallback?: (props: PanelErrorFallbackProps) => ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  retryKey: number;
}

export interface PanelErrorFallbackProps {
  error: Error | null;
  panelName?: string;
  onRetry: () => void;
}

export function PanelErrorFallback({ error, panelName, onRetry }: PanelErrorFallbackProps) {
  const { t } = useTranslation();

  return (
    <div
      className="flex flex-col items-center justify-center h-full w-full bg-background text-foreground p-4 text-center"
      role="alert"
    >
      <div className="bg-destructive/10 p-3 rounded-full mb-4">
        <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden />
      </div>
      <h3 className="text-sm font-semibold mb-1 text-foreground">
        {panelName
          ? t('panelErrorBoundary.namedTitle', { panelName })
          : t('panelErrorBoundary.title')}
      </h3>
      <p className="text-xs text-muted-foreground mb-4 max-w-[200px]">
        {t('panelErrorBoundary.description')}
      </p>
      <div className="bg-muted/50 p-2 rounded text-left mb-4 max-w-full overflow-auto">
        <pre className="font-mono text-[10px] text-foreground/80 whitespace-pre-wrap break-all">
          {error?.message || t('errorBoundary.unknownError')}
        </pre>
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={onRetry}
        className="flex items-center gap-1.5 text-xs"
      >
        <RotateCcw className="h-3 w-3" aria-hidden />
        {t('common.retry')}
      </Button>
    </div>
  );
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
      const fallbackProps = {
        error: this.state.error,
        panelName: this.props.panelName,
        onRetry: this.handleRetry,
      };
      return this.props.renderFallback ? (
        this.props.renderFallback(fallbackProps)
      ) : (
        <PanelErrorFallback {...fallbackProps} />
      );
    }

    return <React.Fragment key={this.state.retryKey}>{this.props.children}</React.Fragment>;
  }
}
