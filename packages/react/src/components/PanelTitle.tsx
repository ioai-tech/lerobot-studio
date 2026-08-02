import React from 'react';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@ioai/lerobot-studio-ui';
import { Plus, X, Video, Image, TrendingUp, FileText, ArrowDown, ArrowRight } from 'lucide-react';
import type { IDockviewPanelHeaderProps } from 'dockview-react';
import { useTranslation } from 'react-i18next';
import { useLeRobot } from '../contexts/LeRobotContext';
import { safeAddPanel } from '../utils/dockviewPanelId';

type PanelType = 'video' | 'image' | 'chart' | 'raw';

export const PanelTitle: React.FC<IDockviewPanelHeaderProps> = (props) => {
  const { api, containerApi } = props;
  const { t } = useTranslation();
  const { info } = useLeRobot();
  const panelId = api.id;
  const panel = containerApi.getPanel(panelId);

  const features = React.useMemo(() => {
    if (!info?.features) return [];
    return Object.keys(info.features).sort();
  }, [info]);

  const getBestPanelTypeForFeature = (featureKey: string): PanelType => {
    const feat = info?.features[featureKey];
    if (!feat) return 'raw';
    if (feat.dtype === 'video') return 'video';
    if (feat.dtype === 'image') return 'image';
    const isNumeric = feat.dtype.includes('float') || feat.dtype.includes('int');
    if (isNumeric) return 'chart';
    return 'raw';
  };

  const getPanelIcon = (type: PanelType) => {
    switch (type) {
      case 'video':
        return <Video className="h-3.5 w-3.5 text-primary" />;
      case 'image':
        return <Image className="h-3.5 w-3.5 text-primary" />;
      case 'chart':
        return <TrendingUp className="h-3.5 w-3.5 text-primary" />;
      default:
        return <FileText className="h-3.5 w-3.5 text-muted-foreground" />;
    }
  };

  const handleAddPanel = (direction: 'right' | 'below', featureKey: string) => {
    if (!panel) return;
    const type = getBestPanelTypeForFeature(featureKey);
    const cleanName = featureKey.split('.').pop() || featureKey;

    safeAddPanel(containerApi, {
      component: type,
      title: cleanName,
      params: { featureKey },
      tabComponent: 'default',
      position: {
        referencePanel: panel.id,
        direction,
      },
      autoId: { type, featureKey },
    });
  };

  const handleDeletePanel = () => {
    if (!panel) return;
    containerApi.removePanel(panel);
  };

  const headerTitle = !panel
    ? api.title || t('common.appName')
    : panel.title || t('common.appName');

  if (!panel) {
    return (
      <div className="panel-title-root flex h-full w-full min-w-0 box-border items-center gap-2 px-2">
        <span
          className="panel-title-text min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-sm"
          title={headerTitle}
        >
          {headerTitle}
        </span>
      </div>
    );
  }

  return (
    <div className="panel-title-root flex h-full w-full min-w-0 box-border items-center gap-2 px-2">
      <span
        className="panel-title-text min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-sm"
        title={headerTitle}
      >
        {headerTitle}
      </span>
      <div className="panel-title-actions ml-auto flex shrink-0 items-center gap-1">
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger
              render={
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 rounded-md opacity-70 hover:bg-accent hover:opacity-100"
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                      }}
                      aria-label={t('common.addPanel')}
                    />
                  }
                />
              }
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
            </TooltipTrigger>
            <TooltipContent side="bottom">{t('common.addPanel')}</TooltipContent>
          </Tooltip>

          <DropdownMenuContent
            align="end"
            className="max-h-[400px] w-64"
            onClick={(e) => e.stopPropagation()}
          >
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <ArrowRight className="mr-2 h-3.5 w-3.5" />
                {t('common.addToRight')}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-[300px] w-64 overflow-y-auto">
                {features.length === 0 ? (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">
                    No features available
                  </div>
                ) : (
                  features.map((key) => {
                    const type = getBestPanelTypeForFeature(key);
                    return (
                      <DropdownMenuItem
                        key={key}
                        onClick={() => handleAddPanel('right', key)}
                        className="gap-2 text-xs"
                      >
                        {getPanelIcon(type)}
                        <span className="truncate" title={key}>
                          {key}
                        </span>
                        <span className="ml-auto text-[9px] text-muted-foreground uppercase opacity-50">
                          {type}
                        </span>
                      </DropdownMenuItem>
                    );
                  })
                )}
              </DropdownMenuSubContent>
            </DropdownMenuSub>

            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <ArrowDown className="mr-2 h-3.5 w-3.5" />
                {t('common.addBelow')}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-[300px] w-64 overflow-y-auto">
                {features.length === 0 ? (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">
                    No features available
                  </div>
                ) : (
                  features.map((key) => {
                    const type = getBestPanelTypeForFeature(key);
                    return (
                      <DropdownMenuItem
                        key={key}
                        onClick={() => handleAddPanel('below', key)}
                        className="gap-2 text-xs"
                      >
                        {getPanelIcon(type)}
                        <span className="truncate" title={key}>
                          {key}
                        </span>
                        <span className="ml-auto text-[9px] text-muted-foreground uppercase opacity-50">
                          {type}
                        </span>
                      </DropdownMenuItem>
                    );
                  })
                )}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>

        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 rounded-md opacity-70 hover:bg-destructive/10 hover:text-destructive hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  handleDeletePanel();
                }}
                aria-label={t('common.deletePanel')}
              />
            }
          >
            <X className="h-3.5 w-3.5" strokeWidth={2.5} />
          </TooltipTrigger>
          <TooltipContent side="bottom">{t('common.deletePanel')}</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
};
