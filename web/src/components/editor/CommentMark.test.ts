import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { describe, expect, it } from 'vitest';
import { CommentMark } from './CommentMark';

function createEditor(content: string): Editor {
  return new Editor({
    extensions: [StarterKit, CommentMark],
    content,
  });
}

describe('CommentMark', () => {
  it('removes the full highlighted range for a single comment mark', () => {
    const editor = createEditor('<p>comment that gets canceled</p>');
    editor.commands.setTextSelection({ from: 1, to: 26 });
    editor.commands.setComment('pending-1');

    editor.commands.unsetComment('pending-1');

    expect(editor.getHTML()).not.toContain('comment-highlight');
    expect(editor.getHTML()).not.toContain('data-comment-id="pending-1"');
    editor.destroy();
  });

  it('removes only the comment mark matching the requested commentId', () => {
    // Risk: canceling one inline comment must not remove overlapping comment highlights.
    const editor = createEditor(
      '<p><span data-comment-id="first"><span data-comment-id="second">Shared</span></span></p>'
    );

    editor.commands.unsetComment('first');

    const html = editor.getHTML();
    expect(html).not.toContain('data-comment-id="first"');
    expect(html).toContain('data-comment-id="second"');
    expect(html).toContain('Shared');

    editor.destroy();
  });
});
