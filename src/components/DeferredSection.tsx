import React, { useEffect, useRef, useState } from 'react';

/** Mount once, shortly before entering the viewport. No child effects run early. */
export default function DeferredSection({ eager = false, hold = false, preloadDistance = 300, onApproach, children }: {
  key?: React.Key;
  eager?: boolean;
  /** While true the section stays unmounted even if it is on screen (used to keep the Hero image first in line). */
  hold?: boolean;
  preloadDistance?: number;
  onApproach?: () => void;
  children: () => React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(eager);
  useEffect(() => {
    if (eager) { onApproach?.(); return; }
    if (visible || hold) return;
    const activate = () => { onApproach?.(); setVisible(true); };
    if (!('IntersectionObserver' in window)) { activate(); return; }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        activate();
        observer.disconnect();
      }
    }, { rootMargin: `${preloadDistance}px 0px` });
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [eager, hold, visible, preloadDistance, onApproach]);
  return <div ref={ref} data-deferred-section={visible || eager ? 'ready' : 'waiting'}
    data-preload-distance={preloadDistance}
    style={visible || eager ? undefined : { minHeight: '60vh' }}>
    {visible || eager ? children() : null}
  </div>;
}
