import React from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, RotateCcw, Home, Copy, Check } from 'lucide-react';
import { Button } from '@/ui';
import { useLeRobotData } from '../../contexts/LeRobotContext';
import { useState } from 'react';

interface ErrorStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
  errorDetail?: string;
}

export const ErrorState: React.FC<ErrorStateProps> = ({ title, message, onRetry, errorDetail }) => {
  const { t } = useTranslation();
  const { reset } = useLeRobotData();
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (errorDetail) {
      navigator.clipboard.writeText(errorDetail);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center p-8 text-center max-w-md mx-auto h-full space-y-6">
      <div className="bg-destructive/10 p-4 rounded-full">
        <AlertCircle className="h-12 w-12 text-destructive" />
      </div>

      <div className="space-y-2">
        <h3 className="text-xl font-bold text-foreground">{title || t('common.error')}</h3>
        <p className="text-muted-foreground">{message || t('errors.generic')}</p>
      </div>

      {errorDetail && (
        <div className="w-full bg-muted/50 rounded-lg p-3 text-left overflow-hidden">
          <div className="flex justify-between items-center mb-2">
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
              {t('errors.details')}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={handleCopy}
              title={t('common.copy')}
            >
              {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
            </Button>
          </div>
          <pre className="text-xs font-mono text-muted-foreground break-all whitespace-pre-wrap max-h-32 overflow-y-auto">
            {errorDetail}
          </pre>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-center gap-3 w-full">
        {onRetry && (
          <Button onClick={onRetry} variant="default" className="gap-2">
            <RotateCcw className="h-4 w-4" />
            {t('common.retry')}
          </Button>
        )}
        <Button onClick={reset} variant="outline" className="gap-2">
          <Home className="h-4 w-4" />
          {t('navbar.goHome')}
        </Button>
      </div>
    </div>
  );
};
