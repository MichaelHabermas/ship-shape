// Verifies the FleetGraph notification rail exposes reviewer proof without hiding the normal notification control.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { FleetGraphNotificationsProbe } from './FleetGraphNotificationsProbe';

vi.mock('@/lib/api', () => ({
  apiGetJson: vi.fn().mockResolvedValue({ notifications: [] }),
  apiPostJson: vi.fn(),
}));

function LocationReadout() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function renderProbe() {
  return render(
    <MemoryRouter initialEntries={['/documents/current']}>
      <FleetGraphNotificationsProbe onDiscuss={() => {}} />
      <Routes>
        <Route path="*" element={<LocationReadout />} />
      </Routes>
    </MemoryRouter>
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('FleetGraphNotificationsProbe', () => {
  it('shows a reviewer proof icon above notifications and navigates to the control room', async () => {
    renderProbe();

    expect(screen.getByRole('button', { name: 'Open notifications' })).toBeInTheDocument();
    const reviewerButton = screen.getByRole('button', { name: 'Open reviewer proof' });
    expect(reviewerButton).toBeInTheDocument();

    fireEvent.click(reviewerButton);

    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent('/fleetgraph/reviewer');
    });
  });
});
