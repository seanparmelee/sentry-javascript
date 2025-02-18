import { DsnComponents, ReplayEnvelope, ReplayEvent, ReplayRecordingData } from '@sentry/types';
import { createEnvelope, createEventEnvelopeHeaders, getSdkMetadataForEnvelopeHeader } from '@sentry/utils';

export function createReplayEnvelope(
  replayEvent: ReplayEvent,
  recordingData: ReplayRecordingData,
  dsn: DsnComponents,
  tunnel?: string,
): ReplayEnvelope {
  return createEnvelope<ReplayEnvelope>(
    createEventEnvelopeHeaders(replayEvent, getSdkMetadataForEnvelopeHeader(replayEvent), tunnel, dsn),
    [
      [{ type: 'replay_event' }, replayEvent],
      [
        {
          type: 'replay_recording',
          length: recordingData.length,
        },
        recordingData,
      ],
    ],
  );
}
