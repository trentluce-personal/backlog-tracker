import { useEffect } from 'react';

// Delegation preserves native button/submit behavior and covers dialogs mounted later.
export function useButtonRipples() {
  useEffect(() => {
    const effects = new Map<HTMLButtonElement, { wave: HTMLSpanElement; animation: Animation }>();
    function remove(button: HTMLButtonElement) {
      const effect = effects.get(button);
      if (!effect) return;
      effects.delete(button);
      effect.animation.cancel();
      effect.wave.remove();
    }
    function show(event: PointerEvent | KeyboardEvent) {
      if (document.documentElement.dataset.motion !== 'full') return;
      const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button.button, button.icon-button, button.nav-item') : null;
      if (!button || button.matches(':disabled') || typeof button.animate !== 'function') return;
      if (event instanceof PointerEvent) {
        if (event.button !== 0) return;
      } else if (event.repeat || !['Enter', ' '].includes(event.key)) return;
      remove(button);
      const bounds = button.getBoundingClientRect();
      const x = event instanceof PointerEvent ? event.clientX - bounds.left : bounds.width / 2;
      const y = event instanceof PointerEvent ? event.clientY - bounds.top : bounds.height / 2;
      const radius = Math.hypot(Math.max(x, bounds.width - x), Math.max(y, bounds.height - y));
      const wave = document.createElement('span');
      wave.className = 'interaction-ripple';
      wave.setAttribute('aria-hidden', 'true');
      Object.assign(wave.style, { width: `${radius * 2}px`, height: `${radius * 2}px`, left: `${x - radius}px`, top: `${y - radius}px` });
      button.append(wave);
      try {
        const animation = wave.animate([
          { transform: 'scale(0)', opacity: .36 },
          { transform: 'scale(1)', opacity: 0 },
        ], { duration: 580, easing: 'cubic-bezier(.2, .7, .3, 1)' });
        effects.set(button, { wave, animation });
        const finish = () => { if (effects.get(button)?.wave === wave) effects.delete(button); wave.remove(); };
        void animation.finished.then(finish, finish);
      } catch { wave.remove(); }
    }
    const observer = new MutationObserver(() => {
      for (const button of effects.keys()) {
        if (!button.isConnected || document.documentElement.dataset.motion !== 'full') remove(button);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-motion'] });
    document.addEventListener('pointerdown', show);
    document.addEventListener('keydown', show);
    return () => {
      document.removeEventListener('pointerdown', show);
      document.removeEventListener('keydown', show);
      observer.disconnect();
      for (const button of effects.keys()) remove(button);
    };
  }, []);
}
