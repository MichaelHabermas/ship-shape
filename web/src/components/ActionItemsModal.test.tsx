import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ActionItemsModal } from './ActionItemsModal';

vi.mock('@/hooks/useActionItemsQuery', () => ({
  useActionItemsQuery: () => ({
    data: {
      items: [
        {
          id: 'standup-1',
          title: 'Submit standup',
          state: 'todo',
          priority: 'high',
          ticket_number: 0,
          display_id: '',
          is_system_generated: true,
          accountability_type: 'standup',
          accountability_target_id: '550e8400-e29b-41d4-a716-446655440000',
          target_title: 'Week 1',
          due_date: '2025-01-30',
          days_overdue: 0,
        },
      ],
      total: 1,
      has_overdue: false,
      has_due_today: true,
    },
    isLoading: false,
  }),
}));

function renderModal() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ActionItemsModal open onClose={() => {}} />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ActionItemsModal', () => {
  it('renders with Radix-recognized title, description, and close control', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    renderModal();

    expect(screen.getByRole('dialog')).toHaveAccessibleName('Action Items');
    expect(screen.getByRole('dialog')).toHaveAccessibleDescription(/pending item/i);
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /submit standup/i })).toBeInTheDocument();

    const consoleOutput = [...consoleError.mock.calls, ...consoleWarn.mock.calls]
      .flat()
      .join('\n');
    expect(consoleOutput).not.toContain('DialogContent');
  });
});
