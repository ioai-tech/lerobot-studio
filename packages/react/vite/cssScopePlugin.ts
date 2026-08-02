import { transform, type Selector } from 'lightningcss';
import type { Plugin } from 'vite';

export type CssScopePluginOptions = {
  /** CSS scope root class (without `.`). Defaults to `lerobot-root`. */
  rootClass?: string;
};

const DEFAULT_ROOT_CLASS = 'lerobot-root';

/**
 * npm package 模式专用：用 Lightning CSS visitor 把选择器限制在 .<rootClass> 下，
 * 避免嵌入宿主页时 Tailwind / dockview / uplot 样式泄漏。
 *
 * SPA（vite.config.ts / npm run dev）不要挂此插件；
 * 仅 vite.lib.config.ts（build:lib）启用。
 * Package 宿主渲染树需存在对应根节点。Class selector permits more than one
 * viewer in a host document, unlike a fixed id selector.
 */
function createScopeCss(rootClass: string) {
  const scopeToken = { type: 'class' as const, name: rootClass };
  const descendant = { type: 'combinator' as const, value: 'descendant' as const };

  function isAlreadyScoped(selector: Selector): boolean {
    return selector[0]?.type === 'class' && selector[0].name === rootClass;
  }

  /**
   * - 已带 .<rootClass> 前缀：跳过（避免重复）
   * - :root / html / body / .dark：保持全局，供 Base UI 默认 body Portal 与官方 dark variant 使用
   * - 其余：写成 .<rootClass> <原选择器>
   */
  function scopeSelector(selector: Selector): Selector {
    if (!selector.length || isAlreadyScoped(selector)) {
      return selector;
    }

    const only = selector.length === 1 ? selector[0] : null;
    if (only?.type === 'pseudo-class' && only.kind === 'root') {
      return selector;
    }
    if (only?.type === 'type' && (only.name === 'html' || only.name === 'body')) {
      return selector;
    }
    if (only?.type === 'class' && only.name === 'dark') {
      return selector;
    }

    return [scopeToken, descendant, ...selector];
  }

  return function scopeCss(css: string, filename = 'scoped.css'): string {
    const { code } = transform({
      filename,
      code: Buffer.from(css),
      visitor: {
        Selector(selector) {
          return scopeSelector(selector);
        },
      },
      // 保持可读性；最终 minify 仍由 Vite / Lightning CSS 构建管线负责
      minify: false,
    });
    return code.toString();
  };
}

/** Test helper for verifying portal-compatible token scoping. */
export function scopeCssForTests(css: string, rootClass = DEFAULT_ROOT_CLASS): string {
  return createScopeCss(rootClass)(css);
}

export function cssScopePlugin(options?: CssScopePluginOptions): Plugin {
  const rootClass = options?.rootClass ?? DEFAULT_ROOT_CLASS;
  const scopeCss = createScopeCss(rootClass);

  return {
    name: 'css-scope-lerobot-root',
    enforce: 'post',
    transform(code, id) {
      const pathname = id.split('?', 1)[0] ?? id;
      if (!pathname.endsWith('.css')) return null;
      try {
        return scopeCss(code, pathname);
      } catch (err) {
        this.warn(
          `css-scope: failed to scope ${pathname}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        return null;
      }
    },
    generateBundle(_options, bundle) {
      for (const item of Object.values(bundle)) {
        if (item.type !== 'asset' || typeof item.source !== 'string') continue;
        if (!item.fileName.endsWith('.css')) continue;
        try {
          item.source = scopeCss(item.source, item.fileName);
        } catch (err) {
          this.warn(
            `css-scope: failed to scope asset ${item.fileName}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }
    },
  };
}
