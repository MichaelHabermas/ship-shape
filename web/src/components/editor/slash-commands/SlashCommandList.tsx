import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useState,
  useCallback,
} from 'react';
import { cn } from '@/lib/cn';
import type { SlashCommandItem } from './slash-command-items';

interface CommandListProps {
  items: SlashCommandItem[];
  command: (item: SlashCommandItem) => void;
}

export interface CommandListRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

export const SlashCommandList = forwardRef<CommandListRef, CommandListProps>(
  ({ items, command }, ref) => {
    const [selectedIndex, setSelectedIndex] = useState(0);

    const selectItem = useCallback(
      (index: number) => {
        const item = items[index];
        if (item) {
          command(item);
        }
      },
      [items, command]
    );

    useEffect(() => {
      setSelectedIndex(0);
    }, [items]);

    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }: { event: KeyboardEvent }) => {
        if (event.key === 'ArrowUp') {
          setSelectedIndex((prev) => (prev + items.length - 1) % items.length);
          return true;
        }

        if (event.key === 'ArrowDown') {
          setSelectedIndex((prev) => (prev + 1) % items.length);
          return true;
        }

        if (event.key === 'Enter') {
          selectItem(selectedIndex);
          return true;
        }

        return false;
      },
    }));

    if (items.length === 0) {
      return null;
    }

    return (
      <div className="z-50 min-w-[200px] overflow-hidden rounded-lg border border-border bg-background shadow-lg">
        {items.map((item, index) => (
          <button
            key={item.title}
            onClick={() => selectItem(index)}
            className={cn(
              'flex w-full items-center gap-3 px-3 py-2 text-left text-sm',
              'hover:bg-border/50 transition-colors',
              index === selectedIndex && 'bg-border/50'
            )}
          >
            <span className="flex h-8 w-8 items-center justify-center rounded bg-border/30 text-muted">
              {item.icon}
            </span>
            <div className="flex-1">
              <div className="font-medium text-foreground">{item.title}</div>
              <div className="text-xs text-muted">{item.description}</div>
            </div>
          </button>
        ))}
      </div>
    );
  }
);

SlashCommandList.displayName = 'SlashCommandList';
