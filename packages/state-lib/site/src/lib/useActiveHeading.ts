import { useEffect, useState } from 'react';
import type { Heading } from './Toc';
import { headerOffset } from './router';

export function useActiveHeading(headings: Heading[]): string {
  const [active, setActive] = useState('');
  useEffect(() => {
    let frame = 0;
    const pick = () => {
      frame = 0;
      let current = headings.find((heading) => document.getElementById(heading.id)?.getClientRects().length)?.id ?? '';
      const line = headerOffset() + 12;
      for (const heading of headings) {
        const element = document.getElementById(heading.id);
        if (element?.getClientRects().length && element.getBoundingClientRect().top <= line) current = heading.id;
      }
      setActive(current);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(pick);
    };
    pick();
    addEventListener('scroll', schedule, { passive: true });
    addEventListener('resize', schedule);
    return () => {
      removeEventListener('scroll', schedule);
      removeEventListener('resize', schedule);
      cancelAnimationFrame(frame);
    };
  }, [headings]);
  return active;
}
