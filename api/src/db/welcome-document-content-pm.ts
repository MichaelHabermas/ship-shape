/** Welcome doc TipTap nodes: program managers. */

export const WELCOME_DOCUMENT_NODES_PM = [
    // ============ FOR PROGRAM MANAGERS ============
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'For Program Managers' }],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Ship combines Notion-style docs with Linear-style issues. Write your specs in the same place you track delivery.' },
      ],
    },

    // Writing a PRD
    {
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: 'Writing a PRD or Spec' }],
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
              { type: 'text', marks: [{ type: 'bold' }], text: 'document icon' },
              { type: 'text', text: ' in the left sidebar to open Docs mode' },
            ],
          }],
        },
        {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Click ' },
              { type: 'text', marks: [{ type: 'bold' }], text: '+ New Document' },
              { type: 'text', text: ' in the sidebar' },
            ],
          }],
        },
        {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Give it a title like "Feature: User Authentication PRD"' },
            ],
          }],
        },
        {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Use the editor to write your spec. Recommended sections:' },
            ],
          }],
        },
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
              { type: 'text', marks: [{ type: 'bold' }], text: 'Problem' },
              { type: 'text', text: ' — What problem are we solving?' },
            ],
          }],
        },
        {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [
              { type: 'text', marks: [{ type: 'bold' }], text: 'Goals' },
              { type: 'text', text: ' — What does success look like?' },
            ],
          }],
        },
        {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [
              { type: 'text', marks: [{ type: 'bold' }], text: 'Requirements' },
              { type: 'text', text: ' — What must the solution do?' },
            ],
          }],
        },
        {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [
              { type: 'text', marks: [{ type: 'bold' }], text: 'Success Metrics' },
              { type: 'text', text: ' — How will we measure success?' },
            ],
          }],
        },
        {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [
              { type: 'text', marks: [{ type: 'bold' }], text: 'Timeline' },
              { type: 'text', text: ' — When do we need this by?' },
            ],
          }],
        },
      ],
    },

    // Organizing Programs
    {
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: 'Organizing Programs and Issues' }],
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
              { type: 'text', marks: [{ type: 'bold' }], text: 'folder icon' },
              { type: 'text', text: ' in the left sidebar to open Programs mode' },
            ],
          }],
        },
        {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Each program has a ' },
              { type: 'text', marks: [{ type: 'bold' }], text: 'prefix' },
              { type: 'text', text: ' (e.g., AUTH, API) that appears on all its issues' },
            ],
          }],
        },
        {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Click a program to see its issues, sprints, and backlog' },
            ],
          }],
        },
        {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Create issues from within the program to auto-assign them' },
            ],
          }],
        },
      ],
    },

    // Week Planning
    {
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: 'Setting Up a Week' }],
    },
    {
      type: 'orderedList',
      content: [
        {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Open a program → Click the ' },
              { type: 'text', marks: [{ type: 'bold' }], text: 'Weeks tab' },
            ],
          }],
        },
        {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Click ' },
              { type: 'text', marks: [{ type: 'bold' }], text: '+ New Week' },
              { type: 'text', text: ' and set start/end dates (typically 2 weeks)' },
            ],
          }],
        },
        {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Drag issues from the backlog into the week, or set the Week property on individual issues' },
            ],
          }],
        },
      ],
    },

    // Week Documentation
    {
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: 'Weekly Plan and Retro Documents' }],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Ship encourages documenting what you expect ' },
        { type: 'text', marks: [{ type: 'italic' }], text: 'before' },
        { type: 'text', text: ' a sprint and what you learned ' },
        { type: 'text', marks: [{ type: 'italic' }], text: 'after' },
        { type: 'text', text: ':' },
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
              { type: 'text', marks: [{ type: 'bold' }], text: 'Weekly Plan' },
              { type: 'text', text: ' (write at week start): What do you expect to accomplish? What\'s the hypothesis?' },
            ],
          }],
        },
        {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [
              { type: 'text', marks: [{ type: 'bold' }], text: 'Weekly Retro' },
              { type: 'text', text: ' (write at week end): What actually happened? What did you learn? What will you do differently?' },
            ],
          }],
        },
      ],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'This creates a learning loop: ' },
        { type: 'text', marks: [{ type: 'bold' }], text: 'plan → execute → reflect → improve' },
        { type: 'text', text: '.' },
      ],
    },

];
