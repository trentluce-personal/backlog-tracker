import { useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent, type RefObject } from 'react';

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function useDetailsResize(row: RefObject<HTMLDivElement | null>, enabled: boolean, blocked: boolean) {
  // A preference belongs to this mounted workspace, never to the saved graph.
  const [preferred, setPreferred] = useState<number | null>(null);
  const [bounds, setBounds] = useState({ min: 320, max: 800, fallback: 340 });
  const [resizing, setResizing] = useState(false);
  const gesture = useRef<{ pointerId: number; element: HTMLDivElement; x: number; width: number; preferred: number | null; next: number; viewportWidth: number; viewportHeight: number } | null>(null);
  const frame = useRef<number | null>(null);
  const width = clamp(preferred ?? bounds.fallback, bounds.min, bounds.max);

  function setWidth(next: number) {
    if (!enabled || blocked || gesture.current) return;
    setPreferred(clamp(next, bounds.min, bounds.max));
  }

  function finish(restore = false, update = true) {
    const current = gesture.current;
    gesture.current = null;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    if (update) {
      setResizing(false);
      if (current) setPreferred(restore ? current.preferred : current.next);
    }
    if (current?.element.hasPointerCapture(current.pointerId)) current.element.releasePointerCapture(current.pointerId);
  }

  useLayoutEffect(() => {
    const element = row.current;
    if (!element) return;
    const measure = () => {
      const mobile = window.innerWidth <= 800;
      const available = mobile ? document.documentElement.clientWidth : element.clientWidth;
      const toolbar = element.querySelector<HTMLElement>('.modeling-canvas-controls');
      const exposed = Math.max(240, (toolbar?.getBoundingClientRect().width ?? 0) + 24);
      const max = mobile ? available : Math.min(800, Math.max(0, available - exposed));
      const next = { min: Math.min(mobile ? available < 320 ? available : 280 : 320, max), max, fallback: available * 2 / 5 };
      setBounds(current => current.min === next.min && current.max === next.max && current.fallback === next.fallback ? current : next);
    };
    const viewportChanged = () => { finish(true); measure(); };
    measure();
    const observer = new ResizeObserver(() => { if (gesture.current) finish(true); measure(); });
    observer.observe(element);
    const toolbar = element.querySelector('.modeling-canvas-controls');
    if (toolbar) observer.observe(toolbar);
    window.addEventListener('resize', viewportChanged);
    return () => { observer.disconnect(); window.removeEventListener('resize', viewportChanged); };
  }, [row]);

  useLayoutEffect(() => {
    if (!enabled || blocked) finish(true);
  }, [enabled, blocked]);

  useLayoutEffect(() => {
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || !gesture.current) return;
      event.preventDefault();
      event.stopPropagation();
      finish(true);
    };
    window.addEventListener('keydown', escape, true);
    return () => { window.removeEventListener('keydown', escape, true); finish(false, false); };
  }, []);

  function move(event: PointerEvent<HTMLDivElement>) {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if (current.viewportWidth !== window.innerWidth || current.viewportHeight !== window.innerHeight) { finish(true); return; }
    event.preventDefault();
    event.stopPropagation();
    current.next = clamp(current.width + current.x - event.clientX, bounds.min, bounds.max);
    if (frame.current === null) frame.current = requestAnimationFrame(() => {
      frame.current = null;
      if (gesture.current) setPreferred(gesture.current.next);
    });
  }

  return {
    width, resizing, gesture,
    canNarrow: enabled && !blocked && !resizing && width > bounds.min,
    canWiden: enabled && !blocked && !resizing && width < bounds.max,
    stepWidth: (direction: -1 | 1) => setWidth(width + direction * 80),
    separator: {
      role: 'separator' as const,
      tabIndex: 0,
      'aria-label': 'Resize details panel',
      'aria-orientation': 'vertical' as const,
      'aria-valuemin': bounds.min,
      'aria-valuemax': bounds.max,
      'aria-valuenow': Math.round(width),
      onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
        if (!enabled || blocked || gesture.current || event.button !== 0 || !event.isPrimary) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.focus({ preventScroll: true });
        event.currentTarget.setPointerCapture(event.pointerId);
        gesture.current = { pointerId: event.pointerId, element: event.currentTarget, x: event.clientX, width, preferred, next: width, viewportWidth: window.innerWidth, viewportHeight: window.innerHeight };
        setResizing(true);
      },
      onPointerMove: move,
      onPointerUp: (event: PointerEvent<HTMLDivElement>) => {
        if (gesture.current?.pointerId !== event.pointerId) return;
        move(event); finish();
      },
      onPointerCancel: (event: PointerEvent<HTMLDivElement>) => { if (gesture.current?.pointerId === event.pointerId) finish(true); },
      onLostPointerCapture: (event: PointerEvent<HTMLDivElement>) => { if (gesture.current?.pointerId === event.pointerId) finish(true); },
      onClick: (event: MouseEvent<HTMLDivElement>) => { event.preventDefault(); event.stopPropagation(); },
      onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
        if (!enabled || blocked || gesture.current) return;
        const step = event.shiftKey ? 80 : 20;
        const next = event.key === 'Home' ? bounds.min : event.key === 'End' ? bounds.max
          : event.key === 'ArrowLeft' ? width + step : event.key === 'ArrowRight' ? width - step : null;
        if (next === null) return;
        event.preventDefault(); event.stopPropagation();
        setWidth(next);
      },
    },
  };
}
