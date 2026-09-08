import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

export default function ScrollToTop() {
  const { pathname } = useLocation();

  useEffect(() => {
    // Immediate scroll
    window.scrollTo(0, 0);
    document.documentElement.scrollTo(0, 0);
    
    // Delayed scroll for a bit more assurance during transitions
    const timeoutId = setTimeout(() => {
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
      document.documentElement.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    }, 10);

    return () => clearTimeout(timeoutId);
  }, [pathname]);

  return null;
}
