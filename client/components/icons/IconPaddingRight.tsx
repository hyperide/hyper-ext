export default function IconPaddingRight({
  className = 'w-3 h-3',
  ...props
}: {
  className?: string;
  [key: string]: unknown;
}) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 12 12" fill="none" {...props}>
      <path d="M10.5 1V11" stroke="currentColor" />
      <path d="M4.5 4.5H7.5V7.5H4.5V4.5Z" stroke="currentColor" />
    </svg>
  );
}
