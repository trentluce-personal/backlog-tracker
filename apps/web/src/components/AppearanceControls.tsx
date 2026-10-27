import { useLayoutEffect, useRef, useState, type MouseEvent } from 'react';
import { applyTheme, readPreference, savePreference, type Motion, type Theme } from '../preferences';
import { prepareThemeReveal } from '../themeReveal';

export function AppearanceControls() {
  const [theme, setTheme] = useState<Theme>(() => document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
  const intendedTheme = useRef(theme);
  const reveal = useRef<(() => void) | null>(null);
  const [motion, setMotion] = useState<Motion>(() => {
    const saved = readPreference('backlog-motion');
    return saved === 'reduce' ? 'reduce' : 'full';
  });

  useLayoutEffect(() => { applyTheme(theme); }, [theme]);
  useLayoutEffect(() => {
    document.documentElement.dataset.motion = motion;
  }, [motion]);

  useLayoutEffect(() => {
    // Any new action dismisses the ornamental snapshot before updating the UI.
    const skip = () => { reveal.current?.(); reveal.current = null; };
    document.addEventListener('pointerdown', skip, true);
    document.addEventListener('keydown', skip, true);
    window.addEventListener('resize', skip);
    return () => {
      skip();
      document.removeEventListener('pointerdown', skip, true);
      document.removeEventListener('keydown', skip, true);
      window.removeEventListener('resize', skip);
    };
  }, []);

  function toggleTheme(event: MouseEvent<HTMLButtonElement>) {
    const from = intendedTheme.current;
    const next = from === 'dark' ? 'light' : 'dark';
    intendedTheme.current = next;
    savePreference('backlog-theme', next);
    reveal.current?.();
    reveal.current = null;
    try {
      if (motion === 'full') reveal.current = prepareThemeReveal(event.currentTarget, from);
    } catch { /* Appearance still changes if snapshot/animation is unavailable. */ }
    applyTheme(next);
    setTheme(next);
  }

  function toggleMotion() {
    reveal.current?.();
    reveal.current = null;
    const next = motion === 'full' ? 'reduce' : 'full';
    setMotion(next);
    savePreference('backlog-motion', next);
  }

  return <div className="appearance-controls" aria-label="Appearance">
    <button type="button" className="text-button motion-toggle" aria-pressed={motion === 'full'}
      aria-label={motion === 'full' ? 'Motion on — reduce motion' : 'Enable animations'} onClick={toggleMotion}>
      {motion === 'full' ? 'Motion on' : 'Enable animations'}
    </button>
    <button type="button" className="button secondary theme-toggle" onClick={toggleTheme}
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`} title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        {theme === 'dark' ? <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" /></>
          : <path d="M20.5 14A9 9 0 0 1 10 3.5 9 9 0 1 0 20.5 14Z" />}
      </svg>
      <span>{theme === 'dark' ? 'Light' : 'Dark'}</span>
    </button>
  </div>;
}
