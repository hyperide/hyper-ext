export default function IconMarginVertical({
  className = 'w-3 h-3',
  ...props
}: {
  className?: string;
  [key: string]: unknown;
}) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 12 12" fill="none" {...props}>
      <rect x="4.5" y="4.5" width="3" height="3" fill="currentColor" />
      <path d="M1 1.5H11" stroke="currentColor" />
      <path d="M1 10.5H11" stroke="currentColor" />
    </svg>
  );
}
