import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionTimeoutModal } from './SessionTimeoutModal';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SessionTimeoutModal', () => {
  it('renders with Radix-recognized title and description', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    render(
      <SessionTimeoutModal
        open
        timeRemaining={30}
        warningType="inactivity"
        onStayLoggedIn={() => {}}
      />
    );

    expect(screen.getByRole('alertdialog')).toHaveAccessibleName(
      'Your session is about to expire'
    );
    expect(screen.getByRole('alertdialog')).toHaveAccessibleDescription(
      'Due to inactivity, you will be logged out automatically. Move your mouse or press any key to stay logged in.'
    );

    const consoleOutput = [...consoleError.mock.calls, ...consoleWarn.mock.calls]
      .flat()
      .join('\n');
    expect(consoleOutput).not.toContain('DialogContent');
  });
});
