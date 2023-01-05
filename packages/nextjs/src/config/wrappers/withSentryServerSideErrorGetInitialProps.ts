import { hasTracingEnabled } from '@sentry/tracing';
import { dynamicSamplingContextToSentryBaggageHeader } from '@sentry/utils';
import type { NextPageContext } from 'next';
import type { ErrorProps } from 'next/error';

import { isBuild } from '../../utils/isBuild';
import { getTransactionFromRequest, withErrorInstrumentation, withTracedServerSideDataFetcher } from './wrapperUtils';

type ErrorGetInitialProps = (context: NextPageContext) => Promise<ErrorProps>;

/**
 * Create a wrapped version of the user's exported `getInitialProps` function in
 * a custom error page ("_error.js").
 *
 * @param origErrorGetInitialProps The user's `getInitialProps` function
 * @param parameterizedRoute The page's parameterized route
 * @returns A wrapped version of the function
 */
export function withSentryServerSideErrorGetInitialProps(
  origErrorGetInitialProps: ErrorGetInitialProps,
): ErrorGetInitialProps {
  return async function (this: unknown, ...args: Parameters<ErrorGetInitialProps>): ReturnType<ErrorGetInitialProps> {
    if (isBuild()) {
      return origErrorGetInitialProps.apply(this, args);
    }

    const [context] = args;
    const { req, res } = context;

    const errorWrappedGetInitialProps = withErrorInstrumentation(origErrorGetInitialProps);

    // Generally we can assume that `req` and `res` are always defined on the server:
    // https://nextjs.org/docs/api-reference/data-fetching/get-initial-props#context-object
    // This does not seem to be the case in dev mode. Because we have no clean way of associating the the data fetcher
    // span with each other when there are no req or res objects, we simply do not trace them at all here.
    if (hasTracingEnabled() && req && res) {
      const tracedGetInitialProps = withTracedServerSideDataFetcher(errorWrappedGetInitialProps, req, res, {
        dataFetcherRouteName: '/_error',
        requestedRouteName: context.pathname,
        dataFetchingMethodName: 'getInitialProps',
      });

      const errorGetInitialProps: ErrorProps & {
        _sentryTraceData?: string;
        _sentryBaggage?: string;
      } = await tracedGetInitialProps.apply(this, args);

      const requestTransaction = getTransactionFromRequest(req);
      if (requestTransaction) {
        errorGetInitialProps._sentryTraceData = requestTransaction.toTraceparent();

        const dynamicSamplingContext = requestTransaction.getDynamicSamplingContext();
        errorGetInitialProps._sentryBaggage = dynamicSamplingContextToSentryBaggageHeader(dynamicSamplingContext);
      }

      return errorGetInitialProps;
    } else {
      return errorWrappedGetInitialProps.apply(this, args);
    }
  };
}
