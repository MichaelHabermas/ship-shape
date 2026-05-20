import { createContext, useContext, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

export interface QueueItem {
  personId: string;
  personName: string;
  weekNumber: number;
  weekName: string;
  type: 'plan' | 'retro';
  sprintId: string;
  docId: string;
}

interface ReviewQueueState {
  queue: QueueItem[];
  currentIndex: number;
  active: boolean;
}

interface ReviewQueueContextValue {
  state: ReviewQueueState;
  start: (queue: QueueItem[]) => void;
  advance: () => void;
  skip: () => void;
  exit: () => void;
}

const ReviewQueueContext = createContext<ReviewQueueContextValue | null>(null);

export function ReviewQueueProvider({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const [state, setState] = useState<ReviewQueueState>({
    queue: [],
    currentIndex: 0,
    active: false,
  });

  // Use a ref to avoid stale closures in setTimeout/callbacks
  const stateRef = useRef(state);
  stateRef.current = state;

  const navigateToItem = useCallback((item: QueueItem) => {
    navigate(`/documents/${item.docId}?review=true&sprintId=${item.sprintId}`);
  }, [navigate]);

  const start = useCallback((queue: QueueItem[]) => {
    if (queue.length === 0) return;
    setState({ queue, currentIndex: 0, active: true });
    navigateToItem(queue[0]);
  }, [navigateToItem]);

  const advanceToNext = useCallback(() => {
    const s = stateRef.current;
    if (!s.active) return;
    const nextIndex = s.currentIndex + 1;
    if (nextIndex >= s.queue.length) {
      setState({ queue: [], currentIndex: 0, active: false });
      navigate('/team/reviews');
    } else {
      setState({ ...s, currentIndex: nextIndex });
      navigateToItem(s.queue[nextIndex]);
    }
  }, [navigate, navigateToItem]);

  const advance = useCallback(() => {
    setTimeout(advanceToNext, 300);
  }, [advanceToNext]);

  const skip = useCallback(() => {
    advanceToNext();
  }, [advanceToNext]);

  const exit = useCallback(() => {
    setState({ queue: [], currentIndex: 0, active: false });
    navigate('/team/reviews');
  }, [navigate]);

  return (
    <ReviewQueueContext.Provider value={{ state, start, advance, skip, exit }}>
      {children}
    </ReviewQueueContext.Provider>
  );
}

export function useReviewQueue() {
  return useContext(ReviewQueueContext);
}
