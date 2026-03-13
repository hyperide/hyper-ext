export default function IconPositionRight({
  className = 'w-3 h-3',
  ...props
}: {
  className?: string;
  [key: string]: unknown;
}) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 12 12" fill="none" {...props}>
      {/* Crosshair: circle + cross + center dot */}
      <circle cx="6" cy="6" r="1.5" stroke="currentColor" />
      <path d="M6 3.5V4.5" stroke="currentColor" />
      <path d="M6 7.5V8.5" stroke="currentColor" />
      <path d="M3.5 6H4.5" stroke="currentColor" />
      <path d="M7.5 6H8.5" stroke="currentColor" />
      <circle cx="6" cy="6" r="0.5" fill="currentColor" />
      {/* Side indicator */}
      <path d="M10.5 1V11" stroke="currentColor" />
    </svg>
  );
}
