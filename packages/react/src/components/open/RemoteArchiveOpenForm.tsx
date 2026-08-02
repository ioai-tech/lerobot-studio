import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@ioai/lerobot-studio-ui';
import { Globe2, AlertCircle } from 'lucide-react';
import { Input } from '@ioai/lerobot-studio-ui';

interface RemoteArchiveOpenFormProps {
  initialUrl?: string;
  onSubmit: (url: string) => void;
  onCancel?: () => void;
  isLoading?: boolean;
}

export const RemoteArchiveOpenForm: React.FC<RemoteArchiveOpenFormProps> = ({
  initialUrl = '',
  onSubmit,
  onCancel,
  isLoading = false,
}) => {
  const { t } = useTranslation();
  const [url, setUrl] = useState(initialUrl);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmedUrl = url.trim();
    if (!trimmedUrl) {
      setError(t('validation.urlRequired'));
      return;
    }

    if (!trimmedUrl.startsWith('http://') && !trimmedUrl.startsWith('https://')) {
      setError(t('validation.invalidUrl'));
      return;
    }

    // 支持带 query/hash 的签名 URL：只根据 pathname 判断压缩包类型
    let pathnameLower: string;
    try {
      pathnameLower = new URL(trimmedUrl).pathname.toLowerCase();
    } catch {
      // 兜底：如果 URL 解析失败，尽量剥离 query/hash 再判断
      pathnameLower = trimmedUrl.split('#')[0].split('?')[0].toLowerCase();
    }
    const supported =
      pathnameLower.endsWith('.zip') ||
      pathnameLower.endsWith('.tar') ||
      pathnameLower.endsWith('.tar.gz') ||
      pathnameLower.endsWith('.tgz');
    if (!supported) {
      setError(t('validation.unsupportedFormat'));
      return;
    }

    onSubmit(trimmedUrl);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 w-full">
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">{t('panels.welcome.sources.remoteArchive')}</p>
        <div className="relative w-full overflow-hidden rounded-md border">
          <Globe2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            className="pl-9 text-base h-11 border-0 rounded-none"
            placeholder="https://example.com/lerobot.zip"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={isLoading}
            autoFocus
          />
        </div>
        {error && (
          <div className="flex items-center gap-1.5 text-xs text-destructive mt-1">
            <AlertCircle className="h-3.5 w-3.5" />
            <span>{error}</span>
          </div>
        )}
      </div>

      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel} disabled={isLoading}>
            {t('common.cancel')}
          </Button>
        )}
        <Button type="submit" disabled={isLoading || !url.trim()}>
          {isLoading ? t('common.loading') : t('common.open')}
        </Button>
      </div>
    </form>
  );
};
