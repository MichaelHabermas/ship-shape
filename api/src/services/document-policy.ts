/**
 * Document policy compiler seed cases — vocabulary for future generated guards.
 * Runtime enforcement lives in `api/src/security/capabilities.ts` (`authorize`).
 */
export type DocumentPolicyAction =
  | 'read'
  | 'write'
  | 'reference'
  | 'content_update'
  | 'delete'
  | 'convert'
  | 'review_accountability'
  | 'collaborate';

export type DocumentPolicyReason =
  | 'allowed'
  | 'document_not_found'
  | 'accountability_scope_denied'
  | 'not_creator_or_admin'
  | 'not_workspace_admin'
  | 'restricted_document_type'
  | 'wrong_reference_type';

export type DocumentPolicyCase = {
  id: string;
  action: DocumentPolicyAction;
  expectedReason: DocumentPolicyReason;
  description: string;
};

export const DOCUMENT_POLICY_CASES: DocumentPolicyCase[] = [
  {
    id: 'workspace-doc-readable',
    action: 'read',
    expectedReason: 'allowed',
    description: 'Workspace-visible documents are readable by workspace members.',
  },
  {
    id: 'private-doc-creator-or-admin',
    action: 'write',
    expectedReason: 'allowed',
    description: 'Private documents remain writable only through the normal readable-document gate.',
  },
  {
    id: 'weekly-doc-person-scope',
    action: 'content_update',
    expectedReason: 'accountability_scope_denied',
    description: 'Weekly plan/retro content updates require the linked person scope, not workspace visibility alone.',
  },
  {
    id: 'document-type-change-creator',
    action: 'convert',
    expectedReason: 'not_creator_or_admin',
    description: 'Document conversion/type changes require the creator.',
  },
  {
    id: 'association-reference-readable',
    action: 'reference',
    expectedReason: 'wrong_reference_type',
    description: 'Associations must reference a readable document of the expected relationship type.',
  },
];
