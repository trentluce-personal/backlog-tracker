import { useLayoutEffect, useRef, useState, type MouseEvent } from 'react';
import { applyTheme, readPreference, savePreference, type Motion, type Theme } from '../preferences';
import { prepareThemeReveal } from '../themeReveal';
import { Moon, Sun, Play, Pause } from 'lucide-react';
import { Icon } from './Icon';

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
      aria-label={motion === 'full' ? 'Motion on — reduce motion' : 'Enable animations'} title={motion === 'full' ? 'Motion on — reduce motion' : 'Enable animations'} onClick={toggleMotion}>
      <Icon icon={motion === 'full' ? Pause : Play} /><span>{motion === 'full' ? 'Motion on' : 'Enable animations'}</span>
    </button>
    <button type="button" className="button secondary theme-toggle" onClick={toggleTheme}
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`} title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}>
      <Icon icon={theme === 'dark' ? Sun : Moon} />
      <span>{theme === 'dark' ? 'Light' : 'Dark'}</span>
    </button>
  </div>;
}
