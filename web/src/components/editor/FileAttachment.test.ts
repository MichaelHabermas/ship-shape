import { describe, it, expect } from 'vitest';
import { FileAttachmentExtension } from './FileAttachment';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';

describe('FileAttachmentExtension', () => {
  it('should create a valid TipTap extension', () => {
    const extension = FileAttachmentExtension;
    expect(extension).toBeDefined();
    expect(extension.name).toBe('fileAttachment');
  });

  it('should be configured as a block-level atom node', () => {
    const extension = FileAttachmentExtension;
    expect(extension.config.group).toBe('block');
    expect(extension.config.atom).toBe(true);
  });

  it('should have addAttributes function defined', () => {
    const extension = FileAttachmentExtension;
    expect(extension.config.addAttributes).toBeDefined();
    expect(typeof extension.config.addAttributes).toBe('function');
  });

  it('should have parseHTML function defined', () => {
    const extension = FileAttachmentExtension;
    expect(extension.config.parseHTML).toBeDefined();
    expect(typeof extension.config.parseHTML).toBe('function');
  });

  it('should have renderHTML function defined', () => {
    const extension = FileAttachmentExtension;
    expect(extension.config.renderHTML).toBeDefined();
    expect(typeof extension.config.renderHTML).toBe('function');
  });

  it('should have addCommands function defined', () => {
    const extension = FileAttachmentExtension;
    expect(extension.config.addCommands).toBeDefined();
    expect(typeof extension.config.addCommands).toBe('function');
  });

  it('should have a ReactNodeViewRenderer for custom rendering', () => {
    const extension = FileAttachmentExtension;
    const nodeView = extension.config.addNodeView;

    expect(nodeView).toBeDefined();
    expect(typeof nodeView).toBe('function');
  });

  it('should work in editor context', () => {
    const editor = new Editor({
      extensions: [StarterKit, FileAttachmentExtension],
      content: '<p>Test content</p>',
    });

    expect(editor).toBeDefined();
    expect(editor.extensionManager.extensions.some(ext => ext.name === 'fileAttachment')).toBe(true);

    editor.destroy();
  });

  it('should allow inserting file attachment via command', () => {
    const editor = new Editor({
      extensions: [StarterKit, FileAttachmentExtension],
      content: '<p>Test content</p>',
    });

    // Check that the command exists
    expect('setFileAttachment' in editor.commands && typeof editor.commands.setFileAttachment === 'function').toBe(true);

    editor.destroy();
  });
});
