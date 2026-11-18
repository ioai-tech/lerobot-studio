import { describe, expect, it, vi } from 'vitest';
import { selectHostMessages } from '../src/react/i18n/hostMessages';

describe('host messages', () => {
  it('applies documented string overrides and converts {{name}} placeholders', () => {
    const warn = vi.fn();
    expect(selectHostMessages({ 'segments.title': 'Clips of {{count}}' }, warn)).toEqual({
      'segments.title': 'Clips of {count}',
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it('keeps the built-in copy for a non-string value and says so, once per key', () => {
    const warn = vi.fn();
    const precompiled = { 'segments.row': [{ type: 0, value: '片段' }] };
    expect(selectHostMessages(precompiled, warn)).toEqual({});
    expect(selectHostMessages(precompiled, warn)).toEqual({});
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      'lerobot-studio: messages["segments.row"] ignored: expected an ICU string, got array',
    );
  });

  it('names an unknown key, once', () => {
    const warn = vi.fn();
    selectHostMessages({ 'segments.nope': 'x' }, warn);
    selectHostMessages({ 'segments.nope': 'x' }, warn);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      'lerobot-studio: messages["segments.nope"] ignored: not a replaceable message key',
    );
  });

  it('skips an unset key silently', () => {
    const warn = vi.fn();
    expect(selectHostMessages({ 'segments.title': undefined }, warn)).toEqual({});
    expect(warn).not.toHaveBeenCalled();
  });
});
