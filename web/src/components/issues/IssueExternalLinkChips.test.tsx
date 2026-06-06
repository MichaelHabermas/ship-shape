// Tests external link chip rendering for issue sidebar integration proof.
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { IssueExternalLinkChips } from './IssueExternalLinkChips';

describe('IssueExternalLinkChips', () => {
  it('renders nothing when links are empty', () => {
    const { container } = render(<IssueExternalLinkChips links={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders provider and title as external anchor', () => {
    render(
      <IssueExternalLinkChips
        links={[{
          provider: 'gitlab',
          external_id: 'team/project!1',
          kind: 'merge_request',
          url: 'https://labs.gauntletai.com/team/project/-/merge_requests/1',
          title: 'PlugForge live proof',
          status: 'opened',
          created_at: '2026-06-06T16:18:31.874Z',
          updated_at: '2026-06-06T16:18:31.874Z',
        }]}
      />,
    );

    const link = screen.getByRole('link', { name: /PlugForge live proof/i });
    expect(link).toHaveAttribute('href', 'https://labs.gauntletai.com/team/project/-/merge_requests/1');
    expect(link).toHaveAttribute('target', '_blank');
    expect(screen.getByText('gitlab')).toBeInTheDocument();
    expect(screen.getByText('(opened)')).toBeInTheDocument();
  });
});
