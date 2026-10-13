import React, { useEffect, useRef, useState } from 'react';

/** Mount once, shortly before entering the viewport. No child effects run early. */
export default function DeferredSection({ eager = false, preloadDistance = 300, onApproach, children }: {
  key?: React.Key;
  eager?: boolean;
  preloadDistance?: number;
  onApproach?: () => void;
  children: () => React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(eager);
  useEffect(() => {
    if (eager) { onApproach?.(); return; }
    if (visible) return;
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
  }, [eager, visible, preloadDistance, onApproach]);
  return <div ref={ref} data-deferred-section={visible || eager ? 'ready' : 'waiting'}
    data-preload-distance={preloadDistance}
    style={visible || eager ? undefined : { minHeight: '60vh' }}>
    {visible || eager ? children() : null}
  </div>;
}
