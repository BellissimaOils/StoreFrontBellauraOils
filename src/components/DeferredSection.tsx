import React, { useEffect, useRef, useState } from 'react';

/** Mount once, shortly before entering the viewport. No child effects run early. */
export default function DeferredSection({ eager = false, children }: {
  key?: React.Key;
  eager?: boolean;
  children: () => React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(eager);
  useEffect(() => {
    if (eager || visible) return;
    if (!('IntersectionObserver' in window)) { setVisible(true); return; }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: '300px 0px' });
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [eager, visible]);
  return <div ref={ref} data-deferred-section={visible || eager ? 'ready' : 'waiting'}
    style={visible || eager ? undefined : { minHeight: '60vh' }}>
    {visible || eager ? children() : null}
  </div>;
}
