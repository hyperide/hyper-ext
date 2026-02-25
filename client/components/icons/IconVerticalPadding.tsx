export default function IconVerticalPadding({
  className = "w-3 h-3",
  ...props
}: {
  className?: string;
  [key: string]: any;
}) {
  return (
    <svg className={className} viewBox="0 0 12 12" fill="none" {...props}>
      <path d="M1 10.5H11" stroke="currentColor" />
      <path d="M1 1.5L11 1.5" stroke="currentColor" />
      <path d="M4.5 4.42896V7.42896H7.5V4.42896H4.5Z" stroke="currentColor" />
    </svg>
  );
}
