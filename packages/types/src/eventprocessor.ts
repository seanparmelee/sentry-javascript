import { Event, EventHint } from './event';

/**
 * Event processors are used to change the event before it will be send.
 * We strongly advise to make this function sync.
 * Returning a PromiseLike<Event | null> will work just fine, but better be sure that you know what you are doing.
 * Event processing will be deferred until your Promise is resolved.
 */
export interface EventProcessor {
  (event: Event, hint: EventHint): PromiseLike<Event | null> | Event | null;
  id?: string; // This field can't be named "name" because functions already have this field natively
}
