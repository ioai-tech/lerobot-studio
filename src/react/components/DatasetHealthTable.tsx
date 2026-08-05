import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { ValidationItem, ValidationCategory } from '@/core';
import { cn } from '@/ui';
import { translateTerm } from './validationI18n';

const CATEGORY_ORDER: ValidationCategory[] = [
  'file_structure',
  'meta_info',
  'features',
  'episodes',
];

const COL_WIDTHS = { field: '25%', current: '25%', expected: '25%', suggestion: '25%' };

function getCategoryLabel(category: ValidationCategory | undefined): string {
  if (!category) return '';
  if (category.startsWith('feature:')) return 'health.validation.categories.features';
  return `health.validation.categories.${category}`;
}

function getRowBgClass(level: ValidationItem['level']): string {
  switch (level) {
    case 'error':
      return 'bg-destructive/10';
    case 'warning':
      return 'bg-amber-500/10 dark:bg-amber-500/20';
    case 'info':
    default:
      return 'bg-green-500/10 dark:bg-green-500/20';
  }
}

interface DatasetHealthTableProps {
  items: ValidationItem[];
  className?: string;
}

export const DatasetHealthTable: React.FC<DatasetHealthTableProps> = ({ items, className }) => {
  const { t } = useTranslation();

  const grouped = useMemo(() => {
    const map = new Map<string, ValidationItem[]>();
    for (const item of items) {
      const cat = item.category ?? 'meta_info';
      const key = cat.startsWith('feature:') ? 'features' : cat;
      const list = map.get(key) ?? [];
      list.push(item);
      map.set(key, list);
    }
    const result: { category: string; items: ValidationItem[] }[] = [];
    for (const cat of CATEGORY_ORDER) {
      const list = map.get(cat);
      if (list?.length) result.push({ category: cat, items: list });
    }
    return result;
  }, [items]);

  const renderSuggestion = (item: ValidationItem) => {
    if (!item.suggestion) return '';
    if (item.code) {
      const sugKey = `health.validation.codes.${item.code}.suggestion`;
      return t(
        sugKey,
        item.suggestion,
        item.suggestionValues as Record<string, string | number> | undefined,
      );
    }
    return item.suggestion;
  };

  if (items.length === 0) {
    return (
      <div className={cn('text-sm text-muted-foreground py-4 text-center', className)}>
        {t('health.noIssues', 'No issues reported')}
      </div>
    );
  }

  return (
    <div className={cn('space-y-4', className)}>
      {grouped.map(({ category, items: groupItems }) => {
        const categoryLabelKey = getCategoryLabel(category as ValidationCategory);
        const categoryLabel = t(categoryLabelKey, category);
        return (
          <section key={category}>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              {categoryLabel}
            </h4>
            <div className="rounded-md border border-border overflow-hidden">
              <table className="w-full text-sm border-collapse table-fixed">
                <colgroup>
                  <col style={{ width: COL_WIDTHS.field }} />
                  <col style={{ width: COL_WIDTHS.current }} />
                  <col style={{ width: COL_WIDTHS.expected }} />
                  <col style={{ width: COL_WIDTHS.suggestion }} />
                </colgroup>
                <thead>
                  <tr className="bg-muted/50 border-b border-border">
                    <th className="text-left py-1.5 px-3 font-medium align-top">
                      {t('health.validation.columns.field', 'Check item')}
                    </th>
                    <th className="text-left py-1.5 px-3 font-medium align-top">
                      {t('health.validation.columns.current', 'Current')}
                    </th>
                    <th className="text-left py-1.5 px-3 font-medium align-top">
                      {t('health.validation.columns.expected', 'Expected')}
                    </th>
                    <th className="text-left py-1.5 px-3 font-medium align-top">
                      {t('health.validation.columns.suggestion', 'Suggestion')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {groupItems.map((item, idx) => (
                    <tr
                      key={`${item.field ?? ''}-${idx}-${item.message.slice(0, 20)}`}
                      className={cn(
                        'border-b border-border/50 last:border-b-0',
                        getRowBgClass(item.level),
                      )}
                    >
                      <td className="py-1.5 px-3 align-top break-words">
                        <div className="min-w-0 break-words">
                          {item.field && <span className="font-medium">{item.field}</span>}
                          {item.code && (
                            <span className="ml-1.5 font-mono text-xs text-muted-foreground">
                              {item.code}
                            </span>
                          )}
                          {!item.field && !item.code && '—'}
                        </div>
                      </td>
                      <td className="py-1.5 px-3 align-top text-muted-foreground break-words">
                        {translateTerm(t, item.current) || item.current || '—'}
                      </td>
                      <td className="py-1.5 px-3 align-top text-muted-foreground break-words">
                        {translateTerm(t, item.expected) || item.expected || '—'}
                      </td>
                      <td className="py-1.5 px-3 align-top text-muted-foreground break-words">
                        {renderSuggestion(item)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </div>
  );
};
