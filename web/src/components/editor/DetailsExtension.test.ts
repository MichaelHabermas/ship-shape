import { describe, it, expect } from 'vitest';
import { DetailsContent, DetailsExtension, DetailsSummary } from './DetailsExtension';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';

describe('DetailsExtension', () => {
  it('should create a valid TipTap extension', () => {
    const extension = DetailsExtension;
    expect(extension).toBeDefined();
    expect(extension.name).toBe('details');
  });

  it('should be configured as a block node with content', () => {
    const extension = DetailsExtension;
    expect(extension.config.group).toBe('block');
    expect(extension.config.content).toBe('detailsSummary detailsContent');
    expect(extension.config.defining).toBe(true);
  });

  it('should have addAttributes function defined', () => {
    const extension = DetailsExtension;
    expect(extension.config.addAttributes).toBeDefined();
    expect(typeof extension.config.addAttributes).toBe('function');
  });

  it('should have parseHTML function defined', () => {
    const extension = DetailsExtension;
    expect(extension.config.parseHTML).toBeDefined();
    expect(typeof extension.config.parseHTML).toBe('function');
  });

  it('should have renderHTML function defined', () => {
    const extension = DetailsExtension;
    expect(extension.config.renderHTML).toBeDefined();
    expect(typeof extension.config.renderHTML).toBe('function');
  });

  it('should have addCommands function defined', () => {
    const extension = DetailsExtension;
    expect(extension.config.addCommands).toBeDefined();
    expect(typeof extension.config.addCommands).toBe('function');
  });

  it('should have addKeyboardShortcuts function defined', () => {
    const extension = DetailsExtension;
    expect(extension.config.addKeyboardShortcuts).toBeDefined();
    expect(typeof extension.config.addKeyboardShortcuts).toBe('function');
  });

  it('should have addOptions function defined', () => {
    const extension = DetailsExtension;
    expect(extension.config.addOptions).toBeDefined();
    expect(typeof extension.config.addOptions).toBe('function');
  });

  it('should work in editor context', () => {
    const editor = new Editor({
      extensions: [StarterKit, DetailsExtension, DetailsSummary, DetailsContent],
      content: '<p>Test content</p>',
    });

    expect(editor).toBeDefined();
    expect(editor.extensionManager.extensions.some(ext => ext.name === 'details')).toBe(true);

    editor.destroy();
  });

  it('should allow inserting details via command', () => {
    const editor = new Editor({
      extensions: [StarterKit, DetailsExtension, DetailsSummary, DetailsContent],
      content: '<p>Test content</p>',
    });

    // Check that the command exists
    expect((editor.commands as any).setDetails).toBeDefined();
    expect(typeof (editor.commands as any).setDetails).toBe('function');

    editor.destroy();
  });
});
