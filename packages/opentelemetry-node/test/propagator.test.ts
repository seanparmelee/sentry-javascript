import { defaultTextMapGetter, defaultTextMapSetter, ROOT_CONTEXT, trace, TraceFlags } from '@opentelemetry/api';
import { suppressTracing } from '@opentelemetry/core';
import { Hub, makeMain } from '@sentry/core';
import { addExtensionMethods, Transaction } from '@sentry/tracing';
import type { TransactionContext } from '@sentry/types';

import {
  SENTRY_BAGGAGE_HEADER,
  SENTRY_DYNAMIC_SAMPLING_CONTEXT_KEY,
  SENTRY_TRACE_HEADER,
  SENTRY_TRACE_PARENT_CONTEXT_KEY,
} from '../src/constants';
import { SentryPropagator } from '../src/propagator';
import { SENTRY_SPAN_PROCESSOR_MAP } from '../src/spanprocessor';

beforeAll(() => {
  addExtensionMethods();
});

describe('SentryPropagator', () => {
  const propagator = new SentryPropagator();
  let carrier: { [key: string]: unknown };

  beforeEach(() => {
    carrier = {};
  });

  it('returns fields set', () => {
    expect(propagator.fields()).toEqual([SENTRY_TRACE_HEADER, SENTRY_BAGGAGE_HEADER]);
  });

  describe('inject', () => {
    describe('baggage and sentry-trace', () => {
      const client = {
        getOptions: () => ({
          environment: 'production',
          release: '1.0.0',
        }),
        getDsn: () => ({
          publicKey: 'abc',
        }),
      };
      // @ts-ignore Use mock client for unit tests
      const hub: Hub = new Hub(client);
      makeMain(hub);

      afterEach(() => {
        SENTRY_SPAN_PROCESSOR_MAP.clear();
      });

      enum PerfType {
        Transaction = 'transaction',
        Span = 'span',
      }

      function createTransactionAndMaybeSpan(type: PerfType, transactionContext: TransactionContext) {
        const transaction = new Transaction(transactionContext, hub);
        SENTRY_SPAN_PROCESSOR_MAP.set(transaction.spanId, transaction);
        if (type === PerfType.Span) {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { spanId, ...ctx } = transactionContext;
          const span = transaction.startChild({ ...ctx, description: transaction.name });
          SENTRY_SPAN_PROCESSOR_MAP.set(span.spanId, span);
        }
      }

      describe.each([PerfType.Transaction, PerfType.Span])('with active %s', type => {
        it.each([
          [
            'should set baggage and header when sampled',
            {
              traceId: 'd4cda95b652f4a1592b449d5929fda1b',
              spanId: '6e0c63257de34c92',
              traceFlags: TraceFlags.SAMPLED,
            },
            {
              name: 'sampled-transaction',
              traceId: 'd4cda95b652f4a1592b449d5929fda1b',
              spanId: '6e0c63257de34c92',
              sampled: true,
            },
            'sentry-environment=production,sentry-release=1.0.0,sentry-transaction=sampled-transaction,sentry-public_key=abc,sentry-trace_id=d4cda95b652f4a1592b449d5929fda1b',
            'd4cda95b652f4a1592b449d5929fda1b-6e0c63257de34c92-1',
          ],
          [
            'should NOT set baggage header when not sampled',
            {
              traceId: 'd4cda95b652f4a1592b449d5929fda1b',
              spanId: '6e0c63257de34c92',
              traceFlags: TraceFlags.NONE,
            },
            {
              name: 'not-sampled-transaction',
              traceId: 'd4cda95b652f4a1592b449d5929fda1b',
              spanId: '6e0c63257de34c92',
              sampled: false,
            },
            'sentry-environment=production,sentry-release=1.0.0,sentry-transaction=not-sampled-transaction,sentry-public_key=abc,sentry-trace_id=d4cda95b652f4a1592b449d5929fda1b',
            'd4cda95b652f4a1592b449d5929fda1b-6e0c63257de34c92-0',
          ],
          [
            'should NOT set baggage header when traceId is empty',
            {
              traceId: '',
              spanId: '6e0c63257de34c92',
              traceFlags: TraceFlags.SAMPLED,
            },
            {
              name: 'empty-traceId-transaction',
              traceId: '',
              spanId: '6e0c63257de34c92',
              sampled: true,
            },
            undefined,
            undefined,
          ],
          [
            'should NOT set baggage header when spanId is empty',
            {
              traceId: 'd4cda95b652f4a1592b449d5929fda1b',
              spanId: '',
              traceFlags: TraceFlags.SAMPLED,
            },
            {
              name: 'empty-spanId-transaction',
              traceId: 'd4cda95b652f4a1592b449d5929fda1b',
              spanId: '',
              sampled: true,
            },
            undefined,
            undefined,
          ],
        ])('%s', (_name, spanContext, transactionContext, baggage, sentryTrace) => {
          createTransactionAndMaybeSpan(type, transactionContext);
          const context = trace.setSpanContext(ROOT_CONTEXT, spanContext);
          propagator.inject(context, carrier, defaultTextMapSetter);
          expect(carrier[SENTRY_BAGGAGE_HEADER]).toBe(baggage);
          expect(carrier[SENTRY_TRACE_HEADER]).toBe(sentryTrace);
        });

        it('should NOT set baggage and sentry-trace header if instrumentation is supressed', () => {
          const spanContext = {
            traceId: 'd4cda95b652f4a1592b449d5929fda1b',
            spanId: '6e0c63257de34c92',
            traceFlags: TraceFlags.SAMPLED,
          };
          const transactionContext = {
            name: 'sampled-transaction',
            traceId: 'd4cda95b652f4a1592b449d5929fda1b',
            spanId: '6e0c63257de34c92',
            sampled: true,
          };
          createTransactionAndMaybeSpan(type, transactionContext);
          const context = suppressTracing(trace.setSpanContext(ROOT_CONTEXT, spanContext));
          propagator.inject(context, carrier, defaultTextMapSetter);
          expect(carrier[SENTRY_TRACE_HEADER]).toBe(undefined);
          expect(carrier[SENTRY_BAGGAGE_HEADER]).toBe(undefined);
        });
      });
    });
  });

  describe('extract', () => {
    it('sets sentry span context on the context', () => {
      const sentryTraceHeader = 'd4cda95b652f4a1592b449d5929fda1b-6e0c63257de34c92-1';
      carrier[SENTRY_TRACE_HEADER] = sentryTraceHeader;
      const context = propagator.extract(ROOT_CONTEXT, carrier, defaultTextMapGetter);
      expect(trace.getSpanContext(context)).toEqual({
        isRemote: true,
        spanId: '6e0c63257de34c92',
        traceFlags: TraceFlags.SAMPLED,
        traceId: 'd4cda95b652f4a1592b449d5929fda1b',
      });
    });

    it('sets defined sentry trace header on context', () => {
      const sentryTraceHeader = 'd4cda95b652f4a1592b449d5929fda1b-6e0c63257de34c92-1';
      carrier[SENTRY_TRACE_HEADER] = sentryTraceHeader;
      const context = propagator.extract(ROOT_CONTEXT, carrier, defaultTextMapGetter);
      expect(context.getValue(SENTRY_TRACE_PARENT_CONTEXT_KEY)).toEqual({
        parentSampled: true,
        parentSpanId: '6e0c63257de34c92',
        traceId: 'd4cda95b652f4a1592b449d5929fda1b',
      });
    });

    it('sets undefined sentry trace header on context', () => {
      const sentryTraceHeader = undefined;
      carrier[SENTRY_TRACE_HEADER] = sentryTraceHeader;
      const context = propagator.extract(ROOT_CONTEXT, carrier, defaultTextMapGetter);
      expect(context.getValue(SENTRY_TRACE_PARENT_CONTEXT_KEY)).toEqual(undefined);
    });

    it('sets defined dynamic sampling context on context', () => {
      const baggage =
        'sentry-environment=production,sentry-release=1.0.0,sentry-transaction=dsc-transaction,sentry-public_key=abc,sentry-trace_id=d4cda95b652f4a1592b449d5929fda1b';
      carrier[SENTRY_BAGGAGE_HEADER] = baggage;
      const context = propagator.extract(ROOT_CONTEXT, carrier, defaultTextMapGetter);
      expect(context.getValue(SENTRY_DYNAMIC_SAMPLING_CONTEXT_KEY)).toEqual({
        environment: 'production',
        public_key: 'abc',
        release: '1.0.0',
        trace_id: 'd4cda95b652f4a1592b449d5929fda1b',
        transaction: 'dsc-transaction',
      });
    });

    it('sets undefined dynamic sampling context on context', () => {
      const baggage = '';
      carrier[SENTRY_BAGGAGE_HEADER] = baggage;
      const context = propagator.extract(ROOT_CONTEXT, carrier, defaultTextMapGetter);
      expect(context.getValue(SENTRY_DYNAMIC_SAMPLING_CONTEXT_KEY)).toEqual(undefined);
    });
  });
});
