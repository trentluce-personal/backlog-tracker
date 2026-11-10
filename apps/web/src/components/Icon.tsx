import type { LucideIcon } from 'lucide-react';

/** UI icons are decorative; the surrounding control supplies its name. */
export function Icon({ icon: Glyph, className = '' }: { icon: LucideIcon; className?: string }) {
  return <Glyph className={`ui-icon ${className}`} size={18} strokeWidth={1.75} aria-hidden="true" focusable="false" />;
}
