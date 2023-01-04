import { REPLAY_SESSION_KEY, WINDOW } from '../../../src/constants';
import { deleteSession } from '../../../src/session/deleteSession';

const storageEngine = WINDOW.sessionStorage;

describe('Unit | session | deleteSession', () => {
  it('deletes a session', function () {
    storageEngine.setItem(
      REPLAY_SESSION_KEY,
      '{"id":"fd09adfc4117477abc8de643e5a5798a","started":1648827162630,"lastActivity":1648827162658}',
    );

    deleteSession();

    expect(storageEngine.getItem(REPLAY_SESSION_KEY)).toBe(null);
  });

  it('deletes an empty session', function () {
    expect(() => deleteSession()).not.toThrow();
  });
});
