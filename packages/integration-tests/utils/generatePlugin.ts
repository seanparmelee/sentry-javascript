import type { Package } from '@sentry/types';
import { readdirSync, readFileSync } from 'fs';
import HtmlWebpackPlugin, { createHtmlTagObject } from 'html-webpack-plugin';
import path from 'path';
import type { Compiler } from 'webpack';

const PACKAGES_DIR = '../../packages';

const tracingOnly = process.env.PW_TRACING_ONLY === 'true';
const bundleKey = process.env.PW_BUNDLE;

// `esm` and `cjs` builds are modules that can be imported / aliased by webpack
const useCompiledModule = bundleKey === 'esm' || bundleKey === 'cjs';

// Bundles need to be injected into HTML before Sentry initialization.
const useBundle = bundleKey && !useCompiledModule;

const BUNDLE_PATHS: Record<string, Record<string, string>> = {
  browser: {
    cjs: 'build/npm/cjs/index.js',
    esm: 'build/npm/esm/index.js',
    bundle_es5: 'build/bundles/bundle.es5.js',
    bundle_es5_min: 'build/bundles/bundle.es5.min.js',
    bundle_es6: 'build/bundles/bundle.js',
    bundle_es6_min: 'build/bundles/bundle.min.js',
  },
  tracing: {
    cjs: 'build/npm/cjs/index.js',
    esm: 'build/npm/esm/index.js',
    bundle_es5: 'build/bundles/bundle.tracing.es5.js',
    bundle_es5_min: 'build/bundles/bundle.tracing.es5.min.js',
    bundle_es6: 'build/bundles/bundle.tracing.js',
    bundle_es6_min: 'build/bundles/bundle.tracing.min.js',
  },
};

/*
 * Generate webpack aliases based on packages in monorepo
 *
 * When using compiled versions of the tracing and browser packages, their aliases look for example like
 *     '@sentry/browser': 'path/to/sentry-javascript/packages/browser/esm/index.js'
 * and all other monorepo packages' aliases look for example like
 *     '@sentry/hub': 'path/to/sentry-javascript/packages/hub'
 *
 * When using bundled versions of the tracing and browser packages, all aliases look for example like
 *     '@sentry/browser': false
 * so that the compiled versions aren't included
 */
function generateSentryAlias(): Record<string, string> {
  const packageNames = readdirSync(PACKAGES_DIR, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .filter(dir => !['apm', 'minimal', 'next-plugin-sentry'].includes(dir.name))
    .map(dir => dir.name);

  return Object.fromEntries(
    packageNames.map(packageName => {
      const packageJSON: Package = JSON.parse(
        readFileSync(path.resolve(PACKAGES_DIR, packageName, 'package.json'), { encoding: 'utf-8' }).toString(),
      );

      const modulePath = path.resolve(PACKAGES_DIR, packageName);

      if (useCompiledModule && bundleKey && BUNDLE_PATHS[packageName]?.[bundleKey]) {
        const bundlePath = path.resolve(modulePath, BUNDLE_PATHS[packageName][bundleKey]);

        return [packageJSON['name'], bundlePath];
      }

      if (useBundle && bundleKey) {
        // If we're injecting a bundle, ignore the webpack imports.
        return [packageJSON['name'], false];
      }

      return [packageJSON['name'], modulePath];
    }),
  );
}

class SentryScenarioGenerationPlugin {
  public requiresTracing: boolean = false;

  private _name: string = 'SentryScenarioGenerationPlugin';

  public apply(compiler: Compiler): void {
    compiler.options.resolve.alias = generateSentryAlias();
    compiler.options.externals =
      useBundle && bundleKey
        ? {
            // To help Webpack resolve Sentry modules in `import` statements in cases where they're provided in bundles rather than in `node_modules`
            '@sentry/browser': 'Sentry',
            '@sentry/tracing': 'Sentry',
          }
        : {};

    // Checking if the current scenario has imported `@sentry/tracing`.
    compiler.hooks.normalModuleFactory.tap(this._name, factory => {
      factory.hooks.parser.for('javascript/auto').tap(this._name, parser => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        parser.hooks.import.tap(this._name, (_statement: unknown, source: string) => {
          if (source === '@sentry/tracing') {
            this.requiresTracing = true;
          }
        });
      });
    });

    compiler.hooks.compilation.tap(this._name, compilation => {
      HtmlWebpackPlugin.getHooks(compilation).alterAssetTags.tapAsync(this._name, (data, cb) => {
        if (useBundle && bundleKey) {
          const useTracingBundle = tracingOnly || this.requiresTracing;
          const bundleName = useTracingBundle ? 'tracing' : 'browser';
          const bundleObject = createHtmlTagObject('script', {
            src: path.resolve(PACKAGES_DIR, bundleName, BUNDLE_PATHS[bundleName][bundleKey]),
          });

          data.assetTags.scripts.unshift(bundleObject);
        }

        cb(null, data);
      });
    });
  }
}

export default SentryScenarioGenerationPlugin;
