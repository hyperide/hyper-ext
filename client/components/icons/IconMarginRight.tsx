export default function IconMarginRight({
  className = 'w-3 h-3',
  ...props
}: {
  className?: string;
  [key: string]: unknown;
}) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 12 12" fill="none" {...props}>
      <rect x="4.5" y="4.5" width="3" height="3" fill="currentColor" />
      <path d="M10.5 1V11" stroke="currentColor" />
    </svg>
  );
}
