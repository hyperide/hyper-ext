import { useEffect } from 'react';
import { getPreviewIframe } from '@/lib/dom-utils';

export function useIframeScrollTracking(
  iframeScrollRef: React.MutableRefObject<{ x: number; y: number }>,
  iframeLoadedCounter: number,
  activeProjectStatus?: string,
) {
  useEffect(() => {
    const iframe = getPreviewIframe();
    if (!iframe?.contentDocument) return;

    const doc = iframe.contentDocument;
    const updateScroll = () => {
      iframeScrollRef.current = {
        x: doc.documentElement.scrollLeft || doc.body.scrollLeft || 0,
        y: doc.documentElement.scrollTop || doc.body.scrollTop || 0,
      };
    };

    updateScroll();
    doc.addEventListener('scroll', updateScroll, { passive: true });
    doc.body?.addEventListener('scroll', updateScroll, { passive: true });

    return () => {
      doc.removeEventListener('scroll', updateScroll);
      doc.body?.removeEventListener('scroll', updateScroll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [iframeLoadedCounter, activeProjectStatus]);
}
