type IconName = 'chevron' | 'history' | 'updates' | 'clock' | 'exchange' | 'arrow';
const paths: Record<IconName, string> = {
  chevron: 'm6 9 6 6 6-6',
  history: 'M3 10h5M3 10V5m0 5a9 9 0 1 1 1 9',
  updates: 'M5 19 19 5M5 5h14v14',
  clock: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18m0 4v5h5',
  exchange: 'M4 8h16m-4-4 4 4-4 4M20 16H4m4-4-4 4 4 4',
  arrow: 'M4 12h16m-6-6 6 6-6 6',
};
/** Small inline vectors avoid platform-dependent Unicode shape and stroke differences. */
export function SiteIcon({ name, className = '' }: { name: IconName; className?: string }) {
  return (
    <svg
      className={`site-icon ${className}`}
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={paths[name]} />
    </svg>
  );
}
