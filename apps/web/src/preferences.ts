export type Theme = 'dark' | 'light';
export type Motion = 'full' | 'reduce';

export function readPreference(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

export function savePreference(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* Keep the session choice. */ }
}

export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  // The bootstrap's inline background is needed only before CSS loads.
  root.style.removeProperty('background-color');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#191918' : '#f6f2eb');
}
