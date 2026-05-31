// Verifies FleetGraph chat turns produce bounded request history.
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FLEETGRAPH_CHAT_HISTORY_LIMIT } from '@ship/shared';
import { useFleetGraphChatTurns } from './useFleetGraphChatTurns';

function readyResponse(body: string) {
  return {
    decision: 'answer',
    answer: {
      title: 'Answer',
      body,
      sources: [],
      humanGate: { required: false },
    },
  };
}

describe('useFleetGraphChatTurns', () => {
  it('returns completed prior turns as bounded chat history when beginning a turn', () => {
    const { result } = renderHook(() => useFleetGraphChatTurns());

    let firstTurnId = 0;
    act(() => {
      const turn = result.current.beginTurn('What changed?');
      firstTurnId = turn.turnId;
      expect(turn.history).toEqual([]);
    });

    act(() => {
      result.current.resolveTurn(firstTurnId, readyResponse('The blocker moved.'));
    });

    act(() => {
      const turn = result.current.beginTurn('What next?');
      expect(turn.history).toEqual([
        { role: 'user', content: 'What changed?' },
        { role: 'assistant', content: 'The blocker moved.' },
      ]);
    });
  });

  it('keeps only the most recent history entries', () => {
    const { result } = renderHook(() => useFleetGraphChatTurns());

    for (let index = 0; index < FLEETGRAPH_CHAT_HISTORY_LIMIT; index += 1) {
      let turnId = 0;
      act(() => {
        turnId = result.current.beginTurn(`Prompt ${index}`).turnId;
      });
      act(() => {
        result.current.resolveTurn(turnId, readyResponse(`Answer ${index}`));
      });
    }

    act(() => {
      const turn = result.current.beginTurn('Fresh prompt');
      expect(turn.history).toHaveLength(FLEETGRAPH_CHAT_HISTORY_LIMIT);
      expect(turn.history[0]).toEqual({ role: 'user', content: 'Prompt 3' });
      expect(turn.history.at(-1)).toEqual({ role: 'assistant', content: 'Answer 5' });
    });
  });

  it('excludes loading and failed turns from request history', () => {
    const { result } = renderHook(() => useFleetGraphChatTurns());
    let loadingTurnId = 0;
    let failedTurnId = 0;

    act(() => {
      loadingTurnId = result.current.beginTurn('Still loading').turnId;
      failedTurnId = result.current.beginTurn('This failed').turnId;
    });

    act(() => {
      result.current.failTurn(failedTurnId, 'Nope');
    });

    act(() => {
      const turn = result.current.beginTurn('Fresh prompt');
      expect(loadingTurnId).toBeGreaterThan(0);
      expect(turn.history).toEqual([]);
    });
  });
});
