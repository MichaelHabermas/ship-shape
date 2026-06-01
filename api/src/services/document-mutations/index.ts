// Document mutation service centralizes canonical document writes and post-commit side effects.
export {
  type MutationResult,
  type DocumentProperties,
  type DocumentAccessRow,
  type UpdateDocumentPatch,
  type CreateDocumentInput,
  type UpdateDocumentContentInput,
  type UpdateDocumentInput,
  type DeleteDocumentInput,
  type ConvertDocumentInput,
} from './types.js';
export { updateDocumentContentMutation } from './update-content.js';
export { createDocumentMutation } from './create.js';
export { updateDocumentMutation } from './update.js';
export { deleteDocumentMutation } from './delete.js';
export { convertDocumentMutation } from './convert.js';
