/** Subset of lowlight `common` languages used in E2E and typical editor flows. */
const LANGUAGE_NAMES = [
  'javascript',
  'typescript',
  'json',
  'bash',
  'python',
  'sql',
  'yaml',
] as const;

async function createConfiguredLowlight() {
  const { createLowlight, common } = await import('lowlight');
  const lowlight = createLowlight();

  for (const name of LANGUAGE_NAMES) {
    const grammar = common[name];
    if (grammar) {
      lowlight.register(name, grammar);
    }
  }

  const javascript = common.javascript;
  if (javascript) {
    lowlight.register('js', javascript);
  }

  return lowlight;
}

type ConfiguredLowlight = Awaited<ReturnType<typeof createConfiguredLowlight>>;

let lowlightPromise: Promise<ConfiguredLowlight> | null = null;

/** Singleton lazy lowlight instance loaded in an async chunk (not on initial entry). */
export function getLowlight(): Promise<ConfiguredLowlight> {
  if (!lowlightPromise) {
    lowlightPromise = createConfiguredLowlight();
  }
  return lowlightPromise;
}

/** Lazy TipTap code-block extension wired to the shared lowlight instance. */
export async function createCodeBlockLowlightExtension() {
  const [{ default: CodeBlockLowlight }, lowlight] = await Promise.all([
    import('@tiptap/extension-code-block-lowlight'),
    getLowlight(),
  ]);

  return CodeBlockLowlight.configure({
    lowlight,
    HTMLAttributes: {
      class: 'code-block-lowlight',
    },
  });
}
