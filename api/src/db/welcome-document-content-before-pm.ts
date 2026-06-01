/** Welcome doc TipTap nodes: intro and developers. */

export const WELCOME_DOCUMENT_NODES_BEFORE_PM = [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Ship helps your team track work, plan sprints, and write documentation—all in one place. Jump to the section that matches your role:' },
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
              { type: 'text', marks: [{ type: 'bold' }], text: 'For Developers' },
              { type: 'text', text: ' — Track issues, manage sprints, update status' },
            ],
          }],
        },
        {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [
              { type: 'text', marks: [{ type: 'bold' }], text: 'For Program Managers' },
              { type: 'text', text: ' — Write specs, organize programs, plan sprints' },
            ],
          }],
        },
        {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [
              { type: 'text', marks: [{ type: 'bold' }], text: 'For Executives' },
              { type: 'text', text: ' — See delivery progress, team workload, and accountability' },
            ],
          }],
        },
      ],
    },

    // ============ FOR DEVELOPERS ============
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'For Developers' }],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Ship works like Linear: you have issues, sprints, and a board view. Here\'s how to get productive fast.' },
      ],
    },

    // Creating an Issue
    {
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: 'Creating an Issue' }],
    },
    {
      type: 'orderedList',
      content: [
        {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Click the ' },
              { type: 'text', marks: [{ type: 'bold' }], text: 'checkbox icon' },
              { type: 'text', text: ' in the left sidebar to open Issues mode' },
            ],
          }],
        },
        {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Click the ' },
              { type: 'text', marks: [{ type: 'bold' }], text: '+ button' },
              { type: 'text', text: ' in the sidebar header to create a new issue' },
            ],
          }],
        },
        {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Type a title (e.g., "Add user authentication")' },
            ],
          }],
        },
        {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [
              { type: 'text', text: 'In the ' },
              { type: 'text', marks: [{ type: 'bold' }], text: 'Properties sidebar' },
              { type: 'text', text: ' (right side), set the Program, Assignee, and Status' },
            ],
          }],
        },
      ],
    },

    // Moving Issues Through Status
    {
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: 'Moving Issues Through Status' }],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Issues flow through these statuses:' },
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
              { type: 'text', marks: [{ type: 'bold' }], text: 'Triage' },
              { type: 'text', text: ' — External feedback awaiting review' },
            ],
          }],
        },
        {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [
              { type: 'text', marks: [{ type: 'bold' }], text: 'Backlog' },
              { type: 'text', text: ' — Ideas and future work, not yet prioritized' },
            ],
          }],
        },
        {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [
              { type: 'text', marks: [{ type: 'bold' }], text: 'Todo' },
              { type: 'text', text: ' — Prioritized and ready to pick up' },
            ],
          }],
        },
        {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [
              { type: 'text', marks: [{ type: 'bold' }], text: 'In Progress' },
              { type: 'text', text: ' — Someone is actively working on this' },
            ],
          }],
        },
        {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [
              { type: 'text', marks: [{ type: 'bold' }], text: 'In Review' },
              { type: 'text', text: ' — Work complete, awaiting review or approval' },
            ],
          }],
        },
        {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [
              { type: 'text', marks: [{ type: 'bold' }], text: 'Done' },
              { type: 'text', text: ' — Work is complete and approved' },
            ],
          }],
        },
        {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [
              { type: 'text', marks: [{ type: 'bold' }], text: 'Cancelled' },
              { type: 'text', text: ' — Work deprioritized or no longer needed' },
            ],
          }],
        },
      ],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'To change status: Open an issue → In the Properties sidebar → Click the ' },
        { type: 'text', marks: [{ type: 'bold' }], text: 'Status dropdown' },
        { type: 'text', text: ' → Select the new status.' },
      ],
    },

    // Week Board vs List View
    {
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: 'Week Board vs List View' }],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Ship offers two ways to view your week:' },
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
              { type: 'text', marks: [{ type: 'bold' }], text: 'Board view' },
              { type: 'text', text: ' — Kanban-style columns (Backlog | Todo | In Progress | In Review | Done). Drag issues between columns to change status.' },
            ],
          }],
        },
        {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [
              { type: 'text', marks: [{ type: 'bold' }], text: 'List view' },
              { type: 'text', text: ' — All issues in a sortable list. Good for triage and bulk status updates.' },
            ],
          }],
        },
      ],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Toggle between views using the view switcher in the sprint header.' },
      ],
    },

    // Daily Workflow
    {
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: 'Daily Workflow' }],
    },
    {
      type: 'orderedList',
      content: [
        {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [
              { type: 'text', marks: [{ type: 'bold' }], text: 'Start of day:' },
              { type: 'text', text: ' Go to your current sprint → Check what\'s assigned to you in "Todo"' },
            ],
          }],
        },
        {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [
              { type: 'text', marks: [{ type: 'bold' }], text: 'Starting work:' },
              { type: 'text', text: ' Move your issue to "In Progress" so the team knows' },
            ],
          }],
        },
        {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [
              { type: 'text', marks: [{ type: 'bold' }], text: 'Finished:' },
              { type: 'text', text: ' Move to "Done" and pick up the next Todo item' },
            ],
          }],
        },
        {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [
              { type: 'text', marks: [{ type: 'bold' }], text: 'Blocked:' },
              { type: 'text', text: ' Add a comment to the issue describing what\'s blocking you' },
            ],
          }],
        },
      ],
    },
];
