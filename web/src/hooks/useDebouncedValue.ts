import { useEffect, useState } from "react";

/**
 * Generic debounce hook.
 *
 * Returns a debounced copy of `value` that only updates after `delayMs`
 * has elapsed without further changes. Useful for search inputs to avoid
 * firing an API request on every keystroke.
 *
 * @param value    The value to debounce.
 * @param delayMs  Delay in milliseconds (default 300).
 */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
