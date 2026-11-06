const preference = typeof window !== 'undefined' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

/** MediaQueryList.matches follows changes to the operating-system preference. */
export const prefersReducedMotion = () => preference?.matches ?? false;
