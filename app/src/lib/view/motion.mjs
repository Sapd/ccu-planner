// Scrolling that respects the "reduce motion" setting.
export const scrollBehavior = () => (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth');
