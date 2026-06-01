/** Welcome doc TipTap nodes: executives and get started. */

export const WELCOME_DOCUMENT_NODES_EXEC_AND_AFTER = [
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'For Executives' }],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Ship gives you visibility into what your teams are delivering and who\'s doing what.' },
      ],
    },

    // Delivery Tracking
    {
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: 'Are We On Track?' }],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'The ' },
        { type: 'text', marks: [{ type: 'bold' }], text: 'Dashboard' },
        { type: 'text', text: ' shows delivery status across your organization:' },
      ],
    },
    {
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [
              { type: 'text', marks: [{ type: 'bold' }], text: 'Week completion rate' },
              { type: 'text', text: ' — Are teams finishing what they committed to?' },
            ],
          }],
        },
        {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [
              { type: 'text', marks: [{ type: 'bold' }], text: 'Velocity trends' },
              { type: 'text', text: ' — Is delivery speeding up or slowing down?' },
            ],
          }],
        },
        {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [
              { type: 'text', marks: [{ type: 'bold' }], text: 'Blockers' },
              { type: 'text', text: ' — What\'s stuck and needs escalation?' },
            ],
          }],
        },
        {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [
              { type: 'text', marks: [{ type: 'bold' }], text: 'Overdue items' },
              { type: 'text', text: ' — What slipped past its deadline?' },
            ],
          }],
        },
      ],
    },

    // Organization Views
    {
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: 'View by Program or Team' }],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Slice your organization\'s work in two ways:' },
      ],
    },
    {
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [
              { type: 'text', marks: [{ type: 'bold' }], text: 'By Program' },
              { type: 'text', text: ' — See progress on major initiatives across multiple teams' },
            ],
          }],
        },
        {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [
              { type: 'text', marks: [{ type: 'bold' }], text: 'By Team' },
              { type: 'text', text: ' — See what each team is working on and their capacity' },
            ],
          }],
        },
      ],
    },

    // Staff Accountability
    {
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: 'Staff Activity and Accountability' }],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'The ' },
        { type: 'text', marks: [{ type: 'bold' }], text: 'Teams view' },
        { type: 'text', text: ' (click the people icon in the sidebar) shows:' },
      ],
    },
    {
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [
              { type: 'text', marks: [{ type: 'bold' }], text: 'What each person is working on' },
              { type: 'text', text: ' — Their assigned issues and current status' },
            ],
          }],
        },
        {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [
              { type: 'text', marks: [{ type: 'bold' }], text: 'Recent activity' },
              { type: 'text', text: ' — Issues completed, comments added, documents edited' },
            ],
          }],
        },
        {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [
              { type: 'text', marks: [{ type: 'bold' }], text: 'Workload distribution' },
              { type: 'text', text: ' — Who\'s overloaded, who has capacity' },
            ],
          }],
        },
      ],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'This gives you clear visibility into who is contributing what—essential for large organizations where accountability matters.' },
      ],
    },

    // What Shipped Recently
    {
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: 'What Shipped Recently?' }],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'The activity feed shows recently completed work across all teams. Filter by:' },
      ],
    },
    {
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [{ type: 'text', text: 'Time period (this week, this month, this quarter)' }],
          }],
        },
        {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [{ type: 'text', text: 'Program' }],
          }],
        },
        {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [{ type: 'text', text: 'Team or individual' }],
          }],
        },
      ],
    },

    // ============ GET STARTED ============
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'Get Started Now' }],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', marks: [{ type: 'bold' }], text: 'Developers:' },
        { type: 'text', text: ' Click the checkbox icon → Find an issue → Move it to "In Progress"' },
      ],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', marks: [{ type: 'bold' }], text: 'Program Managers:' },
        { type: 'text', text: ' Click the document icon → Create a new spec → Share it with your team' },
      ],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', marks: [{ type: 'bold' }], text: 'Executives:' },
        { type: 'text', text: ' Click the people icon → See your team\'s current workload' },
      ],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Questions? Add a comment to this document—Ship supports real-time collaboration, so your team can see and respond immediately.' },
      ],
    },
];
