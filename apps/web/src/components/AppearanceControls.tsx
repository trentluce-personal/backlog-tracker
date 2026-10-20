import { useLayoutEffect, useState } from 'react';
import { applyTheme, readPreference, savePreference, type Motion, type Theme } from '../preferences';

export function AppearanceControls() {
  const [theme, setTheme] = useState<Theme>(() => document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
  const [motion, setMotion] = useState<Motion>(() => {
    const saved = readPreference('backlog-motion');
    return saved === 'reduce' ? 'reduce' : 'full';
  });

  useLayoutEffect(() => { applyTheme(theme); }, [theme]);
  useLayoutEffect(() => {
    document.documentElement.dataset.motion = motion;
  }, [motion]);

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    setTheme(next);
    savePreference('backlog-theme', next);
  }

  function toggleMotion() {
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
