import pg from 'pg';

export type SeedUserRow = {
  id: string;
  name: string;
  person_doc_id: string | null;
};

export type ProgramSeed = {
  id: string;
  prefix: string;
  name: string;
  color: string;
};

export type ProjectSeed = {
  id: string;
  programId: string;
  title: string;
};

export type SprintSeed = {
  id: string;
  programId: string;
  projectId: string;
  number: number;
};

export type SprintToCreate = {
  programId: string;
  projectId: string;
  number: number;
  ownerIdx: number;
};

export type SeedContext = {
  pool: pg.Pool;
  workspaceId: string;
  allUsers: SeedUserRow[];
  programs: ProgramSeed[];
  programTeams: Record<string, number[]>;
  projects: ProjectSeed[];
  currentSprintNumber: number;
  sprintsToCreate: SprintToCreate[];
  sprints: SprintSeed[];
};

export type ShipCoreIssueTemplate = {
  title: string;
  state: string;
  sprintOffset: number | null;
  priority: string;
  estimate: number;
};

export type GenericIssueTemplate = {
  title: string;
  state: string;
  estimate: number;
  sprintOffset: number | null;
  priority: string;
};

export function seedAt<T>(value: T | undefined, label: string): T {
  if (value === undefined) {
    throw new Error(`Seed invariant violated: ${label}`);
  }
  return value;
}

/**
 * Helper to create document associations in the junction table
 * This replaces the legacy program_id, project_id, sprint_id columns
 */
export async function createAssociation(
  pool: pg.Pool,
  documentId: string,
  relatedId: string,
  relationshipType: 'program' | 'project' | 'sprint',
  metadata?: Record<string, unknown>
): Promise<void> {
  await pool.query(
    `INSERT INTO document_associations (document_id, related_id, relationship_type, metadata)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (document_id, related_id, relationship_type) DO NOTHING`,
    [documentId, relatedId, relationshipType, JSON.stringify(metadata || { created_via: 'seed' })]
  );
}

export const PROGRAMS_TO_SEED = [
  { prefix: 'SHIP', name: 'Ship Core', color: '#3B82F6' },
  { prefix: 'AUTH', name: 'Authentication', color: '#8B5CF6' },
  { prefix: 'API', name: 'API Platform', color: '#10B981' },
  { prefix: 'UI', name: 'Design System', color: '#F59E0B' },
  { prefix: 'INFRA', name: 'Infrastructure', color: '#EF4444' },
] as const;

export const PROGRAM_TEAM_NAMES: string[][] = [
  ['Dev User', 'Emma Johnson'],      // Ship Core
  ['Alice Chen', 'Frank Garcia'],    // Authentication
  ['Grace Lee', 'Henry Patel'],      // API Platform
  ['Carol Williams', 'David Kim'],   // Design System
  ['Jack Brown', 'Iris Nguyen'],     // Infrastructure
];

export const PROJECT_TEMPLATES = [
  {
    name: 'Core Features',
    color: '#6366f1',
    emoji: '🚀',
    impact: 5,
    confidence: 4,
    ease: 3,
    plan: 'Building core features will establish the product foundation and attract early adopters.',
    monetary_impact_expected: 50000,
    has_design_review: true,
    design_review_notes: 'Design approved after review session on 2025-01-15. UI mockups finalized.',
  },
  {
    name: 'Bug Fixes',
    color: '#ef4444',
    emoji: '🐛',
    impact: 4,
    confidence: 5,
    ease: 4,
    plan: 'Fixing bugs will improve user retention and reduce support costs.',
    monetary_impact_expected: 15000,
    has_design_review: false,
    design_review_notes: null,
  },
  {
    name: 'Performance',
    color: '#22c55e',
    emoji: '⚡',
    impact: 4,
    confidence: 3,
    ease: 2,
    plan: 'Performance improvements will increase user satisfaction and enable scale.',
    monetary_impact_expected: 25000,
    // No design review fields - will be null/undefined
  },
] as const;

export const SHIP_CORE_ISSUES: ShipCoreIssueTemplate[] = [
  // Sprint -3 (completed, older history): All done
  { title: 'Initial project setup', state: 'done', sprintOffset: -3, priority: 'high', estimate: 8 },
  { title: 'Database schema design', state: 'done', sprintOffset: -3, priority: 'high', estimate: 6 },
  { title: 'Set up development environment', state: 'done', sprintOffset: -3, priority: 'medium', estimate: 4 },
  { title: 'Create basic API structure', state: 'done', sprintOffset: -3, priority: 'medium', estimate: 4 },

  // Sprint -2 (completed): Mostly done, some incomplete (tests pattern alert)
  { title: 'Implement user authentication', state: 'done', sprintOffset: -2, priority: 'high', estimate: 8 },
  { title: 'Add password hashing', state: 'done', sprintOffset: -2, priority: 'high', estimate: 4 },
  { title: 'Create session management', state: 'todo', sprintOffset: -2, priority: 'medium', estimate: 6 },
  { title: 'Build login/logout endpoints', state: 'done', sprintOffset: -2, priority: 'medium', estimate: 4 },
  { title: 'Add CSRF protection', state: 'todo', sprintOffset: -2, priority: 'medium', estimate: 4 },
  { title: 'Write auth unit tests', state: 'todo', sprintOffset: -2, priority: 'low', estimate: 3 },

  // Sprint -1 (completed): Low completion (tests pattern alert - 2 consecutive)
  { title: 'Create document model', state: 'done', sprintOffset: -1, priority: 'high', estimate: 8 },
  { title: 'Implement CRUD operations', state: 'todo', sprintOffset: -1, priority: 'high', estimate: 6 },
  { title: 'Add real-time collaboration', state: 'todo', sprintOffset: -1, priority: 'high', estimate: 8 },
  { title: 'Build WebSocket server', state: 'done', sprintOffset: -1, priority: 'medium', estimate: 6 },
  { title: 'Integrate Yjs for CRDT', state: 'todo', sprintOffset: -1, priority: 'medium', estimate: 6 },
  { title: 'Add offline support', state: 'cancelled', sprintOffset: -1, priority: 'low', estimate: 4 },

  // Current sprint: Mix of done, in_progress, todo
  { title: 'Implement sprint management', state: 'done', sprintOffset: 0, priority: 'high', estimate: 8 },
  { title: 'Create sprint timeline UI', state: 'done', sprintOffset: 0, priority: 'high', estimate: 6 },
  { title: 'Add sprint progress chart', state: 'done', sprintOffset: 0, priority: 'medium', estimate: 4 },
  { title: 'Build issue assignment flow', state: 'in_progress', sprintOffset: 0, priority: 'high', estimate: 6 },
  { title: 'Add bulk issue operations', state: 'in_progress', sprintOffset: 0, priority: 'medium', estimate: 4 },
  { title: 'Create sprint retrospective view', state: 'in_progress', sprintOffset: 0, priority: 'medium', estimate: 4 },
  { title: 'Add sprint velocity metrics', state: 'todo', sprintOffset: 0, priority: 'medium', estimate: 4 },
  { title: 'Implement burndown chart', state: 'todo', sprintOffset: 0, priority: 'medium', estimate: 6 },
  { title: 'Add sprint completion notifications', state: 'todo', sprintOffset: 0, priority: 'low', estimate: 2 },

  // Sprint +1 (upcoming): Some planned todo items
  { title: 'Add team workload view', state: 'todo', sprintOffset: 1, priority: 'high', estimate: 8 },
  { title: 'Create capacity planning', state: 'todo', sprintOffset: 1, priority: 'high', estimate: 6 },
  { title: 'Build resource allocation UI', state: 'todo', sprintOffset: 1, priority: 'medium', estimate: 4 },
  { title: 'Add team availability calendar', state: 'backlog', sprintOffset: 1, priority: 'low', estimate: 3 },

  // Sprint +2 (upcoming): Fewer planned items
  { title: 'Implement reporting dashboard', state: 'todo', sprintOffset: 2, priority: 'medium', estimate: 6 },
  { title: 'Add export to PDF', state: 'backlog', sprintOffset: 2, priority: 'low', estimate: 4 },

  // Sprint +3 (upcoming): Empty - no issues assigned

  // Backlog (no sprint): Ideas for future
  { title: 'Add dark mode support', state: 'backlog', sprintOffset: null, priority: 'low', estimate: 4 },
  { title: 'Implement keyboard shortcuts', state: 'backlog', sprintOffset: null, priority: 'low', estimate: 3 },
  { title: 'Create mobile app', state: 'backlog', sprintOffset: null, priority: 'low', estimate: 40 },
  { title: 'Add AI-powered suggestions', state: 'backlog', sprintOffset: null, priority: 'low', estimate: 16 },
  { title: 'Build integration with Slack', state: 'backlog', sprintOffset: null, priority: 'medium', estimate: 8 },
];

export const GENERIC_ISSUE_TEMPLATES: GenericIssueTemplate[] = [
  // Completed issues (past sprints)
  { title: 'Set up project structure', state: 'done', estimate: 4, sprintOffset: -2, priority: 'high' },
  { title: 'Create initial documentation', state: 'done', estimate: 3, sprintOffset: -2, priority: 'medium' },
  { title: 'Define coding standards', state: 'done', estimate: 2, sprintOffset: -2, priority: 'low' },
  { title: 'Configure CI/CD pipeline', state: 'done', estimate: 6, sprintOffset: -1, priority: 'high' },
  { title: 'Set up staging environment', state: 'done', estimate: 4, sprintOffset: -1, priority: 'medium' },
  // Current sprint - mix of states
  { title: 'Implement core features', state: 'done', estimate: 8, sprintOffset: 0, priority: 'high' },
  { title: 'Add input validation', state: 'done', estimate: 4, sprintOffset: 0, priority: 'high' },
  { title: 'Create error handling', state: 'in_progress', estimate: 5, sprintOffset: 0, priority: 'high' },
  { title: 'Build user interface', state: 'in_progress', estimate: 6, sprintOffset: 0, priority: 'medium' },
  { title: 'Add unit tests', state: 'todo', estimate: 4, sprintOffset: 0, priority: 'medium' },
  { title: 'Write integration tests', state: 'todo', estimate: 5, sprintOffset: 0, priority: 'low' },
  // Upcoming sprint
  { title: 'Performance optimization', state: 'todo', estimate: 6, sprintOffset: 1, priority: 'medium' },
  { title: 'Add caching layer', state: 'todo', estimate: 4, sprintOffset: 1, priority: 'medium' },
  { title: 'Security audit fixes', state: 'todo', estimate: 8, sprintOffset: 1, priority: 'high' },
  // Backlog
  { title: 'Implement analytics', state: 'backlog', estimate: 6, sprintOffset: null, priority: 'low' },
  { title: 'Add export functionality', state: 'backlog', estimate: 4, sprintOffset: null, priority: 'low' },
  { title: 'Create admin dashboard', state: 'backlog', estimate: 10, sprintOffset: null, priority: 'medium' },
];

export const STANDUP_MESSAGES = [
  {
    content: {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Yesterday: Finished implementing the sprint timeline UI component.' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Today: Working on the progress chart integration.' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Blockers: None' }] },
      ],
    },
  },
  {
    content: {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Yesterday: Code review and bug fixes.' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Today: Starting on issue assignment flow.' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Blockers: Waiting on API spec clarification.' }] },
      ],
    },
  },
  {
    content: {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Yesterday: Team sync and planning session.' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Today: Documentation and testing.' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Blockers: None' }] },
      ],
    },
  },
] as const;

export const SPRINT_PLANS = [
  'If we complete these features, we will unblock the next milestone.',
  'Fixing these issues will reduce user-reported problems by 50%.',
  'Performance gains will improve user engagement metrics.',
  'New features will increase user activation rate.',
  'These changes will enable the team to move faster.',
  'Better docs will reduce onboarding time for new developers.',
  'Incremental shipping will maintain momentum and user trust.',
] as const;

export const SPRINT_SUCCESS_CRITERIA = [
  'All planned stories marked done, tests passing',
  'Bug count reduced by at least 10, no P0 issues remaining',
  'Load time under 2 seconds, memory usage stable',
  'Feature flags enabled for 100% of users',
  'All integrations passing health checks',
  'README and API docs up to date',
  'User feedback incorporated in next sprint planning',
] as const;

export const SPRINT_REVIEW_CONTENT = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'What went well' }] },
    { type: 'bulletList', content: [
      { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Team collaboration was excellent' }] }] },
      { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Met most of our sprint goals' }] }] },
    ]},
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'What could be improved' }] },
    { type: 'bulletList', content: [
      { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Better estimation on complex tasks' }] }] },
      { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'More frequent check-ins' }] }] },
    ]},
  ],
} as const;

export const STANDALONE_WIKI_DOCS = [
  { title: 'Project Overview', content: 'Overview of the Ship project and its goals.' },
  { title: 'Architecture Guide', content: 'Technical architecture and design decisions.' },
  { title: 'API Reference', content: 'API endpoints and usage documentation.' },
  { title: 'Development Setup', content: 'How to set up your local development environment.' },
] as const;
