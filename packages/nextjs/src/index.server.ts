import type { Carrier } from '@sentry/core';
import { getHubFromCarrier, getMainCarrier } from '@sentry/core';
import { RewriteFrames } from '@sentry/integrations';
import { configureScope, getCurrentHub, init as nodeInit, Integrations } from '@sentry/node';
import { hasTracingEnabled } from '@sentry/tracing';
import type { EventProcessor } from '@sentry/types';
import { escapeStringForRegex, logger } from '@sentry/utils';
import * as domainModule from 'domain';
import * as path from 'path';

import { isBuild } from './utils/isBuild';
import { buildMetadata } from './utils/metadata';
import type { NextjsOptions } from './utils/nextjsOptions';
import type { IntegrationWithExclusionOption } from './utils/userIntegrations';
import { addOrUpdateIntegration } from './utils/userIntegrations';

export * from '@sentry/node';
export { captureUnderscoreErrorException } from './utils/_error';

// Exporting the Replay integration also from index.server.ts because TS only recognizes types from index.server.ts
// If we didn't export this, TS would complain that it can't find `Sentry.Replay` in the package,
// causing a build failure, when users initialize Replay in their sentry.client.config.js/ts file.
export { Replay } from './index.client';

// Here we want to make sure to only include what doesn't have browser specifics
// because or SSR of next.js we can only use this.
export { ErrorBoundary, showReportDialog, withErrorBoundary } from '@sentry/react';

const globalWithInjectedValues = global as typeof global & {
  __rewriteFramesDistDir__: string;
};

const domain = domainModule as typeof domainModule & { active: (domainModule.Domain & Carrier) | null };

// This is a variable that Next.js will string replace during build with a string if run in an edge runtime from Next.js
// v12.2.1-canary.3 onwards:
// https://github.com/vercel/next.js/blob/166e5fb9b92f64c4b5d1f6560a05e2b9778c16fb/packages/next/build/webpack-config.ts#L206
// https://edge-runtime.vercel.sh/features/available-apis#addressing-the-runtime
declare const EdgeRuntime: string | undefined;

// Exporting this constant means we can compute it without the linter complaining, even if we stop directly using it in
// this file. It's important that it be computed as early as possible, because one of its indicators is seeing 'build'
// (as in the CLI command `next build`) in `process.argv`. Later on in the build process, everything's been spun out
// into child threads and `argv` turns into ['node', 'path/to/childProcess.js'], so the original indicator is lost. We
// thus want to compute it as soon as the SDK is loaded for the first time, which is normally when the user imports
// `withSentryConfig` into `next.config.js`.
export const IS_BUILD = isBuild();
const IS_VERCEL = !!process.env.VERCEL;

/** Inits the Sentry NextJS SDK on node. */
export function init(options: NextjsOptions): void {
  if (__DEBUG_BUILD__ && options.debug) {
    logger.enable();
  }

  if (typeof EdgeRuntime === 'string') {
    __DEBUG_BUILD__ && logger.log('Vercel Edge Runtime detected. Will not initialize SDK.');
    return;
  }

  __DEBUG_BUILD__ && logger.log('Initializing SDK...');

  if (sdkAlreadyInitialized()) {
    __DEBUG_BUILD__ && logger.log('SDK already initialized');
    return;
  }

  buildMetadata(options, ['nextjs', 'node']);
  options.environment = options.environment || process.env.NODE_ENV;
  addServerIntegrations(options);
  // Right now we only capture frontend sessions for Next.js
  options.autoSessionTracking = false;

  // In an ideal world, this init function would be called before any requests are handled. That way, every domain we
  // use to wrap a request would inherit its scope and client from the global hub. In practice, however, handling the
  // first request is what causes us to initialize the SDK, as the init code is injected into `_app` and all API route
  // handlers, and those are only accessed in the course of handling a request. As a result, we're already in a domain
  // when `init` is called. In order to compensate for this and mimic the ideal world scenario, we stash the active
  // domain, run `init` as normal, and then restore the domain afterwards, copying over data from the main hub as if we
  // really were inheriting.
  const activeDomain = domain.active;
  domain.active = null;

  nodeInit(options);

  const filterTransactions: EventProcessor = event => {
    return event.type === 'transaction' && event.transaction === '/404' ? null : event;
  };

  filterTransactions.id = 'NextServer404TransactionFilter';

  configureScope(scope => {
    scope.setTag('runtime', 'node');
    if (IS_VERCEL) {
      scope.setTag('vercel', true);
    }

    scope.addEventProcessor(filterTransactions);
  });

  if (activeDomain) {
    const globalHub = getHubFromCarrier(getMainCarrier());
    const domainHub = getHubFromCarrier(activeDomain);

    // apply the changes made by `nodeInit` to the domain's hub also
    domainHub.bindClient(globalHub.getClient());
    domainHub.getScope()?.update(globalHub.getScope());
    // `scope.update()` doesn’t copy over event processors, so we have to add it manually
    domainHub.getScope()?.addEventProcessor(filterTransactions);

    // restore the domain hub as the current one
    domain.active = activeDomain;
  }

  __DEBUG_BUILD__ && logger.log('SDK successfully initialized');
}

function sdkAlreadyInitialized(): boolean {
  const hub = getCurrentHub();
  return !!hub.getClient();
}

function addServerIntegrations(options: NextjsOptions): void {
  let integrations = options.integrations || [];

  // This value is injected at build time, based on the output directory specified in the build config. Though a default
  // is set there, we set it here as well, just in case something has gone wrong with the injection.
  const distDirName = globalWithInjectedValues.__rewriteFramesDistDir__ || '.next';
  // nextjs always puts the build directory at the project root level, which is also where you run `next start` from, so
  // we can read in the project directory from the currently running process
  const distDirAbsPath = path.resolve(process.cwd(), distDirName);
  const SOURCEMAP_FILENAME_REGEX = new RegExp(escapeStringForRegex(distDirAbsPath));

  const defaultRewriteFramesIntegration = new RewriteFrames({
    iteratee: frame => {
      frame.filename = frame.filename?.replace(SOURCEMAP_FILENAME_REGEX, 'app:///_next');
      return frame;
    },
  });
  integrations = addOrUpdateIntegration(defaultRewriteFramesIntegration, integrations);

  const defaultOnUncaughtExceptionIntegration: IntegrationWithExclusionOption = new Integrations.OnUncaughtException({
    exitEvenIfOtherHandlersAreRegistered: false,
  });
  defaultOnUncaughtExceptionIntegration.allowExclusionByUser = true;
  integrations = addOrUpdateIntegration(defaultOnUncaughtExceptionIntegration, integrations, {
    _options: { exitEvenIfOtherHandlersAreRegistered: false },
  });

  if (hasTracingEnabled(options)) {
    const defaultHttpTracingIntegration = new Integrations.Http({ tracing: true });
    integrations = addOrUpdateIntegration(defaultHttpTracingIntegration, integrations, {
      _tracing: {},
    });
  }

  options.integrations = integrations;
}

// TODO (v8): Remove this
/**
 * @deprecated Use the constant `IS_BUILD` instead.
 */
const deprecatedIsBuild = (): boolean => isBuild();
// eslint-disable-next-line deprecation/deprecation
export { deprecatedIsBuild as isBuild };

export type { SentryWebpackPluginOptions } from './config/types';
export { withSentryConfig } from './config/withSentryConfig';
export {
  withSentryGetServerSideProps,
  withSentryGetStaticProps,
  withSentryServerSideGetInitialProps,
  withSentryServerSideAppGetInitialProps,
  withSentryServerSideDocumentGetInitialProps,
  withSentryServerSideErrorGetInitialProps,
  withSentryAPI,
  withSentry,
} from './config/wrappers';

// Wrap various server methods to enable error monitoring and tracing. (Note: This only happens for non-Vercel
// deployments, because the current method of doing the wrapping a) crashes Next 12 apps deployed to Vercel and
// b) doesn't work on those apps anyway. We also don't do it during build, because there's no server running in that
// phase.)
if (!IS_BUILD && !IS_VERCEL) {
  // Dynamically require the file because even importing from it causes Next 12 to crash on Vercel.
  // In environments where the JS file doesn't exist, such as testing, import the TS file.
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { instrumentServer } = require('./utils/instrumentServer.js');
    instrumentServer();
  } catch (err) {
    __DEBUG_BUILD__ && logger.warn(`Error: Unable to instrument server for tracing. Got ${err}.`);
  }
}
