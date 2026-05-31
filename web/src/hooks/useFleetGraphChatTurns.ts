// Manages FleetGraph context-chat turn state and history-safe submit orchestration.
import { useCallback, useReducer, useRef } from 'react';
import type { FleetGraphChatHistoryEntry, FleetGraphChatResponse } from '@ship/shared';
import { FLEETGRAPH_CHAT_HISTORY_LIMIT } from '@ship/shared';

export interface FleetGraphChatTurn {
  id: number;
  prompt: string;
  status: 'loading' | 'ready' | 'error';
  response?: Pick<FleetGraphChatResponse, 'decision' | 'answer'>;
  errorMessage?: string;
}

type TurnAction =
  | { type: 'append'; id: number; prompt: string }
  | { type: 'resolve'; id: number; response: Pick<FleetGraphChatResponse, 'decision' | 'answer'> }
  | { type: 'fail'; id: number; errorMessage: string }
  | { type: 'set_ready'; id: number; response: Pick<FleetGraphChatResponse, 'decision' | 'answer'> }
  | { type: 'clear' };

function turnReducer(state: FleetGraphChatTurn[], action: TurnAction): FleetGraphChatTurn[] {
  switch (action.type) {
    case 'append':
      return [...state, { id: action.id, prompt: action.prompt, status: 'loading' }];
    case 'resolve':
    case 'set_ready':
      return state.map((turn) => turn.id === action.id
        ? { ...turn, status: 'ready', response: action.response }
        : turn);
    case 'fail':
      return state.map((turn) => turn.id === action.id
        ? { ...turn, status: 'error', errorMessage: action.errorMessage }
        : turn);
    case 'clear':
      return [];
    default:
      return state;
  }
}

function historyFromTurns(turns: FleetGraphChatTurn[]): FleetGraphChatHistoryEntry[] {
  return turns.flatMap<FleetGraphChatHistoryEntry>((turn) => {
    if (turn.status !== 'ready' || !turn.response?.answer.body) return [];
    const entries: FleetGraphChatHistoryEntry[] = [{ role: 'user', content: turn.prompt }];
    entries.push({ role: 'assistant', content: turn.response.answer.body });
    return entries;
  }).slice(-FLEETGRAPH_CHAT_HISTORY_LIMIT);
}

export function useFleetGraphChatTurns() {
  const [turns, dispatch] = useReducer(turnReducer, []);
  const nextTurnIdRef = useRef(1);

  const clearTurns = useCallback(() => {
    nextTurnIdRef.current = 1;
    dispatch({ type: 'clear' });
  }, []);

  const beginTurn = useCallback((prompt: string) => {
    const turnId = nextTurnIdRef.current;
    nextTurnIdRef.current += 1;
    const history = historyFromTurns(turns);
    dispatch({ type: 'append', id: turnId, prompt });
    return { turnId, history };
  }, [turns]);

  const resolveTurn = useCallback((turnId: number, response: Pick<FleetGraphChatResponse, 'decision' | 'answer'>) => {
    dispatch({ type: 'resolve', id: turnId, response });
  }, []);

  const failTurn = useCallback((turnId: number, errorMessage: string) => {
    dispatch({ type: 'fail', id: turnId, errorMessage });
  }, []);

  const setTurnReady = useCallback((turnId: number, response: Pick<FleetGraphChatResponse, 'decision' | 'answer'>) => {
    dispatch({ type: 'set_ready', id: turnId, response });
  }, []);

  return {
    chatTurns: turns,
    clearTurns,
    beginTurn,
    resolveTurn,
    failTurn,
    setTurnReady,
  };
}
