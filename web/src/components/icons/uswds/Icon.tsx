import {
  type ComponentType,
  type SVGProps,
  lazy,
  Suspense,
  useMemo,
} from 'react';
import { type IconName, isValidIconName } from './types';

export interface IconProps {
  /** The name of the USWDS icon to render */
  name: IconName;
  /** CSS class names for styling (use Tailwind classes like "h-4 w-4") */
  className?: string;
  /** Accessible title for the icon. If provided, the icon will be accessible to screen readers. */
  title?: string;
}

type SvgComponent = ComponentType<SVGProps<SVGSVGElement>>;

// Use Vite's glob import to get all USWDS icons as lazy-loadable modules
// This works because glob imports are resolved at build time
const iconModules = import.meta.glob<{ default: SvgComponent }>(
  '/node_modules/@uswds/uswds/dist/img/usa-icons/*.svg',
  { query: '?react' },
);

// Build a map from icon name to its loader function
const iconLoaders = new Map<string, () => Promise<{ default: SvgComponent }>>();
for (const [path, loader] of Object.entries(iconModules)) {
  // Extract icon name from path: /node_modules/@uswds/uswds/dist/img/usa-icons/check.svg -> check
  const name = path.split('/').pop()?.replace('.svg', '');

  if (name) {
    iconLoaders.set(name, loader);
  }
}

// Cache for lazy-loaded icon components
const iconCache = new Map<string, ReturnType<typeof lazy<SvgComponent>>>();

// Get or create a lazy-loaded icon component
function getLazyIcon(name: string) {
  if (!iconCache.has(name)) {
    const loader = iconLoaders.get(name);
    if (!loader) return null;

    const LazyIcon = lazy<SvgComponent>(loader);
    iconCache.set(name, LazyIcon);
  }

  return iconCache.get(name) ?? null;
}

/**
 * USWDS Icon Component
 *
 * Renders icons from the U.S. Web Design System icon library.
 * Icons use `currentColor` for fill, so they inherit the text color of their parent.
 *
 * @example
 * // Basic usage with Tailwind sizing
 * <Icon name="check" className="h-4 w-4" />
 *
 * @example
 * // With accessible title
 * <Icon name="warning" className="h-5 w-5 text-yellow-500" title="Warning" />
 *
 * @example
 * // Inheriting text color
 * <span className="text-blue-600">
 *   <Icon name="info" className="h-4 w-4" />
 * </span>
 */
export function Icon({
  name,
  className,
  title,
}: IconProps): JSX.Element | null {
  // Validate icon name at runtime
  if (!isValidIconName(name)) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('Icon: Invalid icon name.', name, 'Check available icons in types.ts.');
    }

    return null;
  }

  // Memoize the lazy icon component lookup
  const LazyIcon = useMemo(() => getLazyIcon(name), [name]);

  // Handle case where icon loader wasn't found (shouldn't happen if types are in sync)
  if (!LazyIcon) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(
        `Icon: Could not load icon "${name}". Icon may not be available.`,
      );
    }

    return null;
  }

  // Accessibility attributes following USWDS patterns
  // Note: SVGR-generated components don't forward children, so we use
  // aria-label instead of aria-labelledby + <title> child element.
  const accessibilityProps = title
    ? {
        role: 'img' as const,
        'aria-label': title,
      }
    : {
        'aria-hidden': true as const,
        focusable: false as const,
        role: 'img' as const,
      };

  return (
    <Suspense fallback={<span className={className} />}>
      <LazyIcon
        className={className}
        fill="currentColor"
        {...accessibilityProps}
      />
    </Suspense>
  );
}

export default Icon;
