import { lazy, Suspense, useState, useRef, useEffect, type ComponentProps } from 'react';
import type { EmojiClickData } from 'emoji-picker-react';
import { cn } from '@/lib/cn';

const EmojiPicker = lazy(async () => {
  const module = await import('emoji-picker-react');
  return {
    default: function LazyEmojiPicker(props: Omit<ComponentProps<typeof module.default>, 'theme'>) {
      return <module.default {...props} theme={module.Theme.DARK} />;
    },
  };
});

interface EmojiPickerPopoverProps {
  value?: string | null;
  onChange: (emoji: string | null) => void;
  children: React.ReactNode;
  className?: string;
}

export function EmojiPickerPopover({ value, onChange, children, className }: EmojiPickerPopoverProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // Close on escape
  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen]);

  const handleEmojiClick = (emojiData: EmojiClickData) => {
    onChange(emojiData.emoji);
    setIsOpen(false);
  };

  const handleClear = () => {
    onChange(null);
    setIsOpen(false);
  };

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-background rounded"
      >
        {children}
      </button>

      {isOpen && (
        <div className="absolute z-50 mt-2 left-0">
          <div className="rounded-lg border border-border bg-background shadow-lg overflow-hidden">
            {value && (
              <button
                type="button"
                onClick={handleClear}
                className="w-full px-3 py-2 text-sm text-left text-muted hover:bg-border/50 border-b border-border"
              >
                Remove emoji
              </button>
            )}
            <Suspense fallback={<div className="flex h-[350px] w-[300px] items-center justify-center text-sm text-muted">Loading...</div>}>
              <EmojiPicker
                onEmojiClick={handleEmojiClick}
                skinTonesDisabled={true}
                height={350}
                width={300}
                searchPlaceholder="Search emoji..."
                previewConfig={{ showPreview: false }}
              />
            </Suspense>
          </div>
        </div>
      )}
    </div>
  );
}
