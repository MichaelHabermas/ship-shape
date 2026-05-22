import { Node, mergeAttributes, InputRule } from '@tiptap/core';
import { ReactRenderer } from '@tiptap/react';
import tippy, { Instance as TippyInstance } from 'tippy.js';
import { EmojiList } from './EmojiList';
import Suggestion from '@tiptap/suggestion';
import { PluginKey } from '@tiptap/pm/state';

export interface EmojiItem {
  emoji: string;
  shortcode: string;
  keywords: string[];
}

interface EmojiListRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

// Curated list of common emojis
interface EmojiNodeAttrs {
  emoji?: string | null;
}

interface EmojiAttributes {
  emoji?: string | null;
}

export const EMOJI_LIST: EmojiItem[] = [
  { emoji: '👍', shortcode: '+1', keywords: ['thumbs', 'up', 'yes', 'approve'] },
  { emoji: '👎', shortcode: '-1', keywords: ['thumbs', 'down', 'no', 'disapprove'] },
  { emoji: '❤️', shortcode: 'heart', keywords: ['love', 'like', 'favorite'] },
  { emoji: '😊', shortcode: 'smile', keywords: ['happy', 'joy', 'pleased'] },
  { emoji: '😂', shortcode: 'joy', keywords: ['laugh', 'lol', 'funny', 'tears'] },
  { emoji: '🎉', shortcode: 'tada', keywords: ['celebration', 'party', 'congrats'] },
  { emoji: '✅', shortcode: 'check', keywords: ['done', 'complete', 'yes', 'approved'] },
  { emoji: '❌', shortcode: 'x', keywords: ['no', 'cancel', 'wrong', 'error'] },
  { emoji: '⚠️', shortcode: 'warning', keywords: ['alert', 'caution', 'attention'] },
  { emoji: '🔥', shortcode: 'fire', keywords: ['hot', 'trending', 'lit'] },
  { emoji: '💯', shortcode: '100', keywords: ['perfect', 'hundred', 'full'] },
  { emoji: '🚀', shortcode: 'rocket', keywords: ['launch', 'ship', 'deploy', 'fast'] },
  { emoji: '💡', shortcode: 'bulb', keywords: ['idea', 'light', 'think'] },
  { emoji: '📝', shortcode: 'memo', keywords: ['note', 'write', 'document'] },
  { emoji: '🐛', shortcode: 'bug', keywords: ['insect', 'error', 'issue'] },
  { emoji: '✨', shortcode: 'sparkles', keywords: ['shine', 'new', 'clean', 'special'] },
  { emoji: '🎯', shortcode: 'target', keywords: ['goal', 'aim', 'bullseye'] },
  { emoji: '💪', shortcode: 'muscle', keywords: ['strong', 'strength', 'power'] },
  { emoji: '🙏', shortcode: 'pray', keywords: ['please', 'thanks', 'hope'] },
  { emoji: '👀', shortcode: 'eyes', keywords: ['look', 'see', 'watch'] },
  { emoji: '🤔', shortcode: 'thinking', keywords: ['hmm', 'wonder', 'consider'] },
  { emoji: '😅', shortcode: 'sweat_smile', keywords: ['nervous', 'relief', 'phew'] },
  { emoji: '🙌', shortcode: 'raised_hands', keywords: ['celebrate', 'hooray', 'yay'] },
  { emoji: '👏', shortcode: 'clap', keywords: ['applause', 'congrats', 'well done'] },
  { emoji: '💪', shortcode: 'strong', keywords: ['power', 'flex', 'strength'] },
  { emoji: '🎨', shortcode: 'art', keywords: ['design', 'creative', 'paint'] },
  { emoji: '📚', shortcode: 'books', keywords: ['library', 'read', 'learn'] },
  { emoji: '⏰', shortcode: 'clock', keywords: ['time', 'alarm', 'schedule'] },
  { emoji: '📅', shortcode: 'calendar', keywords: ['date', 'schedule', 'plan'] },
  { emoji: '✏️', shortcode: 'pencil', keywords: ['write', 'edit', 'draw'] },
  { emoji: '📌', shortcode: 'pushpin', keywords: ['pin', 'important', 'note'] },
  { emoji: '🔖', shortcode: 'bookmark', keywords: ['save', 'mark', 'tag'] },
  { emoji: '🔍', shortcode: 'mag', keywords: ['search', 'find', 'look'] },
  { emoji: '💬', shortcode: 'speech_balloon', keywords: ['comment', 'chat', 'talk'] },
  { emoji: '💻', shortcode: 'computer', keywords: ['code', 'laptop', 'work'] },
  { emoji: '📱', shortcode: 'phone', keywords: ['mobile', 'device', 'cell'] },
  { emoji: '🖥️', shortcode: 'desktop', keywords: ['computer', 'monitor', 'screen'] },
  { emoji: '⚡', shortcode: 'zap', keywords: ['lightning', 'fast', 'power', 'energy'] },
  { emoji: '🌟', shortcode: 'star', keywords: ['favorite', 'special', 'shine'] },
  { emoji: '🎁', shortcode: 'gift', keywords: ['present', 'box', 'surprise'] },
  { emoji: '🏆', shortcode: 'trophy', keywords: ['win', 'award', 'champion'] },
  { emoji: '🚧', shortcode: 'construction', keywords: ['wip', 'work in progress', 'building'] },
  { emoji: '🔒', shortcode: 'lock', keywords: ['secure', 'private', 'closed'] },
  { emoji: '🔓', shortcode: 'unlock', keywords: ['open', 'public', 'unlocked'] },
  { emoji: '🆕', shortcode: 'new', keywords: ['fresh', 'latest', 'recent'] },
  { emoji: '🆙', shortcode: 'up', keywords: ['level up', 'increase', 'upgrade'] },
  { emoji: '🔴', shortcode: 'red_circle', keywords: ['dot', 'error', 'stop'] },
  { emoji: '🟢', shortcode: 'green_circle', keywords: ['dot', 'success', 'go'] },
  { emoji: '🟡', shortcode: 'yellow_circle', keywords: ['dot', 'warning', 'caution'] },
];

// Filter emojis by query
function filterEmojis(query: string): EmojiItem[] {
  if (!query) {
    return EMOJI_LIST.slice(0, 20); // Show first 20 by default
  }

  const lowerQuery = query.toLowerCase();
  return EMOJI_LIST.filter((item) => {
    // Match shortcode or keywords
    return (
      item.shortcode.toLowerCase().includes(lowerQuery) ||
      item.keywords.some((keyword) => keyword.toLowerCase().includes(lowerQuery))
    );
  }).slice(0, 20); // Limit to 20 results
}

// Find emoji by exact shortcode match
function findEmojiByShortcode(shortcode: string): EmojiItem | undefined {
  const lowerShortcode = shortcode.toLowerCase();
  return EMOJI_LIST.find((item) => item.shortcode.toLowerCase() === lowerShortcode);
}

export const EmojiExtension = Node.create({
  name: 'emoji',

  group: 'inline',

  inline: true,

  selectable: false,

  atom: true,

  addAttributes() {
    return {
      emoji: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-emoji'),
        renderHTML: (attributes: EmojiAttributes) => {
          if (!attributes.emoji) {
            return {};
          }
          return {
            'data-emoji': attributes.emoji,
          };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-emoji]',
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const attrs = node.attrs as EmojiNodeAttrs;
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-emoji': attrs.emoji,
      }),
      attrs.emoji,
    ];
  },

  renderText({ node }) {
    const attrs = node.attrs as EmojiNodeAttrs;
    return attrs.emoji ?? '';
  },

  addInputRules() {
    // Match :shortcode: pattern and convert to emoji
    // Regex: colon, then word characters/underscores/hyphens, then colon
    const emojiInputRule = new InputRule({
      find: /:([a-zA-Z0-9_+-]+):$/,
      handler: ({ state, range, match }) => {
        const shortcode = match[1];
        if (!shortcode) {
          return null;
        }

        const emoji = findEmojiByShortcode(shortcode);
        if (!emoji) {
          // No matching emoji, don't transform
          return null;
        }

        // Replace the :shortcode: with the emoji character
        // Modifying state.tr in place applies the transformation
        const textNode = state.schema.text(emoji.emoji + ' ');
        state.tr.replaceWith(range.from, range.to, textNode);
      },
    });

    return [emojiInputRule];
  },

  addProseMirrorPlugins() {
    return [
      Suggestion<EmojiItem>({
        editor: this.editor,
        char: ':',
        allowSpaces: false,
        pluginKey: new PluginKey('emoji'),
        items: ({ query }) => {
          // If query ends with ':', check for exact shortcode match (auto-complete pattern)
          // This is handled by onUpdate below
          if (query.endsWith(':')) {
            const shortcode = query.slice(0, -1);
            const exactMatch = findEmojiByShortcode(shortcode);
            // Return just the exact match for auto-selection
            return exactMatch ? [exactMatch] : [];
          }
          return filterEmojis(query);
        },
        command: ({ editor, range, props }) => {
          const emoji = props as EmojiItem;
          // Replace the trigger and query with the emoji
          editor
            .chain()
            .focus()
            .deleteRange(range)
            .insertContent(emoji.emoji + ' ')
            .run();
        },
        render: () => {
          let component: ReactRenderer<EmojiListRef> | null = null;
          let popup: TippyInstance[] | null = null;
          let currentCommand: ((item: EmojiItem) => void) | null = null;
          let currentQuery = '';

          return {
            onStart: (props) => {
              currentCommand = props.command;
              currentQuery = props.query;

              component = new ReactRenderer(EmojiList, {
                props: {
                  items: props.items,
                  command: props.command,
                  query: props.query,
                },
                editor: props.editor,
              });

              if (!props.clientRect) {
                return;
              }

              popup = tippy('body', {
                getReferenceClientRect: props.clientRect as () => DOMRect,
                appendTo: () => document.body,
                content: component.element,
                showOnCreate: true,
                interactive: true,
                trigger: 'manual',
                placement: 'bottom-start',
              });
            },

            onUpdate(props) {
              currentCommand = props.command;
              currentQuery = props.query;

              // Auto-convert :shortcode: pattern when query ends with ':'
              if (props.query.endsWith(':') && props.items.length === 1) {
                // Exact match found - auto-execute the command
                props.command(props.items[0]);
                return;
              }

              component?.updateProps({
                items: props.items,
                command: props.command,
                query: props.query,
              });

              if (!props.clientRect) {
                return;
              }

              popup?.[0]?.setProps({
                getReferenceClientRect: props.clientRect as () => DOMRect,
              });
            },

            onKeyDown(props) {
              if (props.event.key === 'Escape') {
                popup?.[0]?.hide();
                return true;
              }

              // Intercept ':' key for auto-complete pattern :shortcode:
              if (props.event.key === ':' && currentCommand) {
                const exactMatch = findEmojiByShortcode(currentQuery);
                if (exactMatch) {
                  // Found exact match - auto-insert the emoji
                  currentCommand(exactMatch);
                  return true; // Prevent the ':' from being typed
                }
              }

              return component?.ref?.onKeyDown(props) ?? false;
            },

            onExit() {
              popup?.[0]?.destroy();
              component?.destroy();
            },
          };
        },
      }),
    ];
  },
});
