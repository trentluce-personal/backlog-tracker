// Keep the live page interactive: native View Transitions can retarget rapid
// pointerdown events to <html> even when every snapshot pseudo passes pointers.
export function prepareThemeReveal(button: HTMLButtonElement, from: 'light' | 'dark'): (() => void) | null {
  if (typeof Element.prototype.animate !== 'function' || typeof CSS.registerProperty !== 'function' || !CSS.supports('mask-image', 'radial-gradient(circle, transparent, black)')) return null;
  const root = document.documentElement;
  const source = document.getElementById('root');
  if (!source) return null;
  const bounds = button.getBoundingClientRect();
  const x = bounds.left + bounds.width / 2;
  const y = bounds.top + bounds.height / 2;
  const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  const stage = document.createElement('div');
  stage.className = 'theme-reveal-stage';
  stage.dataset.direction = from === 'light' ? 'shadow' : 'radiance';
  stage.inert = true;
  stage.setAttribute('aria-hidden', 'true');
  stage.style.setProperty('--theme-x', `${x}px`);
  stage.style.setProperty('--theme-y', `${y}px`);
  const overlay = document.createElement('div');
  overlay.className = 'theme-reveal';
  overlay.inert = true;
  overlay.setAttribute('aria-hidden', 'true');
  const computed = getComputedStyle(root);
  // Freeze the old palette on the inert copy; the actual document changes now.
  for (const property of computed) {
    if (property.startsWith('--')) overlay.style.setProperty(property, computed.getPropertyValue(property));
  }
  overlay.style.colorScheme = computed.colorScheme;
  overlay.style.setProperty('--theme-x', `${x}px`);
  overlay.style.setProperty('--theme-y', `${y}px`);
  const copy = source.cloneNode(true) as HTMLElement;
  copy.removeAttribute('id');
  copy.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
  copy.querySelectorAll('.interaction-ripple').forEach(node => node.remove());
  copy.style.width = `${root.clientWidth}px`;
  copy.style.transform = `translate(${-scrollX}px, ${-scrollY}px)`;
  // Preserve any in-progress form values without introducing active controls.
  const originals = source.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input, textarea, select');
  copy.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input, textarea, select').forEach((node, index) => { node.value = originals[index].value; });
  overlay.append(copy);
  const halo = document.createElement('div');
  halo.className = 'theme-reveal-halo';
  halo.inert = true;
  halo.setAttribute('aria-hidden', 'true');
  const atmosphere = document.createElement('div');
  atmosphere.className = 'theme-reveal-atmosphere';
  atmosphere.inert = true;
  atmosphere.setAttribute('aria-hidden', 'true');
  stage.append(overlay, halo, atmosphere);
  const animations: Animation[] = [];
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let cancelled = false;
  const cancel = () => {
    if (cancelled) return;
    cancelled = true;
    clearTimeout(timeout);
    animations.forEach(animation => animation.cancel());
    stage.remove();
  };
  const animate = (node: HTMLElement, frames: Keyframe[], timing: KeyframeAnimationOptions) => {
    const animation = node.animate(frames, timing);
    animations.push(animation);
    // Handle cancellation even if creating a later animation throws.
    void animation.finished.catch(cancel);
  };
  try {
    document.body.append(stage);
    // Carry even the broad penumbra/bloom past the far corner before removal.
    const frames = [
      { '--theme-reveal-radius': '0px' },
      { '--theme-reveal-radius': `${radius + 420}px` },
    ];
    const shadow = from === 'light';
    const duration = shadow ? 2200 : 1800;
    const timing = { duration, easing: shadow ? 'cubic-bezier(.42, 0, .58, 1)' : 'cubic-bezier(.16, .25, .5, 1)', fill: 'both' as const };
    animate(overlay, frames, timing);
    for (const layer of [halo, atmosphere]) {
      animate(layer, frames, timing);
      animate(layer, [
        { opacity: 0 }, { opacity: layer === halo ? 1 : .65, offset: shadow ? .18 : .12 },
        { opacity: layer === halo ? 1 : .65, offset: .65 }, { opacity: 0 },
      ], { duration, fill: 'both' });
    }
    void Promise.all(animations.map(animation => animation.finished)).then(cancel, cancel);
    // A browser animation failure must never leave an old-palette copy behind.
    timeout = setTimeout(cancel, duration + 450);
    return cancel;
  } catch {
    cancel();
    return null;
  }
}
