/**
 * Re-exports from the canonical tag registry.
 * This file is kept for backward compatibility — all consumers can import from here or from tagRegistry directly.
 */
export {
  isReducibleDimensionTag,
} from './tagRegistry.js'

/**
 * Legacy export — reducible dimension tags are no longer tracked as a separate list.
 * All non-instrument tags are now blocked at review time.
 */
export const REDUCIBLE_DIMENSION_TAGS: ReadonlyArray<string> = []
