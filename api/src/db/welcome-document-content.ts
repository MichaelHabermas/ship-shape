/**
 * TipTap JSON for the welcome onboarding document.
 */
import { WELCOME_DOCUMENT_NODES_BEFORE_PM } from './welcome-document-content-before-pm.js';
import { WELCOME_DOCUMENT_NODES_PM } from './welcome-document-content-pm.js';
import { WELCOME_DOCUMENT_NODES_EXEC_AND_AFTER } from './welcome-document-content-exec.js';

export const WELCOME_DOCUMENT_CONTENT = {
  type: 'doc',
  content: [
    ...WELCOME_DOCUMENT_NODES_BEFORE_PM,
    ...WELCOME_DOCUMENT_NODES_PM,
    ...WELCOME_DOCUMENT_NODES_EXEC_AND_AFTER,
  ],
};
