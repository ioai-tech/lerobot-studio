import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { AlertCircle, RotateCcw } from 'lucide-react';
import { Button } from '@/ui';
import { useTranslation } from 'react-i18next';
import { I18nProvider } from '../i18n/core';

interface Props {
  children?: ReactNode;
  fallback?: ReactNode;
  renderFallback?: (props: ErrorFallbackProps) => ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export interface ErrorFallbackProps {
  error: Error | null;
  onReset: () => void;
}

export function formatErrorForDisplay(error: Error | null, includeStack: boolean): string {
  if (!error) return '';
  if (!includeStack || !error.stack) return error.message;
  return `${error.message}\n\n${error.stack}`;
}

/** Function component kept separate so the class boundary can use i18n and tests can render it directly. */
export function ErrorFallback({ error, onReset }: ErrorFallbackProps) {
  const { t } = useTranslation();
  const errorDetails = formatErrorForDisplay(error, import.meta.env.DEV);

  return (
    <div
      className="flex flex-col items-center justify-center min-h-screen bg-background p-6 text-center"
      role="alert"
    >
      <div className="bg-destructive/10 p-4 rounded-full mb-6">
        <AlertCircle className="h-12 w-12 text-destructive" aria-hidden />
      </div>
      <h1 className="text-2xl font-bold mb-2">{t('errorBoundary.title')}</h1>
      <p className="text-muted-foreground mb-8 max-w-md mx-auto">
        {t('errorBoundary.description')}
      </p>
      <div className="bg-muted p-4 rounded-lg mb-8 max-w-2xl w-full overflow-auto text-left">
        <p className="font-mono text-xs text-destructive mb-1 font-bold">
          {t('errorBoundary.errorLabel')}:
        </p>
        <pre className="font-mono text-xs text-muted-foreground whitespace-pre-wrap">
          {errorDetails || t('errorBoundary.unknownError')}
        </pre>
      </div>
      <Button onClick={onReset} className="flex items-center gap-2">
        <RotateCcw className="h-4 w-4" aria-hidden />
        {t('errorBoundary.reload')}
      </Button>
    </div>
  );
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

      const fallbackProps = { error: this.state.error, onReset: this.handleReset };
      if (this.props.renderFallback) {
        return this.props.renderFallback(fallbackProps);
      }

      return (
        <I18nProvider>
          <ErrorFallback {...fallbackProps} />
        </I18nProvider>
      );
    }

    return this.props.children;
  }
}
