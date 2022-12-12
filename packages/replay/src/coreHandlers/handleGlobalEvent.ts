import { addBreadcrumb } from '@sentry/core';
import { Event } from '@sentry/types';

import type { ReplayContainer } from '../types';

/**
 * Returns a listener to be added to `addGlobalEventProcessor(listener)`.
 */
export function handleGlobalEventListener(replay: ReplayContainer): (event: Event) => Event {
  return (event: Event) => {
    // Only tag transactions with replayId if not waiting for an error
    // @ts-ignore private
    if (event.type !== 'transaction' || replay.recordingMode === 'session') {
      event.tags = { ...event.tags, replayId: replay.session?.id };
    }

    // Collect traceIds in _context regardless of `recordingMode` - if it's true,
    // _context gets cleared on every checkout
    if (event.type === 'transaction' && event.contexts && event.contexts.trace && event.contexts.trace.trace_id) {
      replay.getContext().traceIds.add(event.contexts.trace.trace_id as string);
      return event;
    }

    // no event type means error
    if (!event.type) {
      replay.getContext().errorIds.add(event.event_id as string);
    }

    const exc = event.exception?.values?.[0];
    if (__DEBUG_BUILD__ && replay.getOptions()._experiments?.traceInternals) {
      addInternalBreadcrumb({
        message: `Tagging event (${event.event_id}) - ${event.message} - ${exc?.type || 'Unknown'}: ${
          exc?.value || 'n/a'
        }`,
      });
    }

    // Need to be very careful that this does not cause an infinite loop
    if (replay.recordingMode === 'error' && event.exception) {
      setTimeout(async () => {
        // Allow flush to complete before resuming as a session recording, otherwise
        // the checkout from `startRecording` may be included in the payload.
        // Prefer to keep the error replay as a separate (and smaller) segment
        // than the session replay.
        await replay.flushImmediate();

        if (replay.stopRecording()) {
          // Reset all "capture on error" configuration before
          // starting a new recording
          replay.recordingMode = 'session';
          replay.startRecording();
        }
      });
    }

    return event;
  };
}

function addInternalBreadcrumb(arg: Parameters<typeof addBreadcrumb>[0]): void {
  const { category, level, message, ...rest } = arg;

  addBreadcrumb({
    category: category || 'console',
    level: level || 'debug',
    message: `[debug]: ${message}`,
    ...rest,
  });
}
