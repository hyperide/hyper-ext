export default function IconHorizontalPadding({
  className = "w-3 h-3",
  ...props
}: {
  className?: string;
  [key: string]: any;
}) {
  return (
    <svg className={className} viewBox="0 0 12 12" fill="none" {...props}>
      <path d="M1.5 1V11" stroke="currentColor" />
      <path d="M10.5 1V11" stroke="currentColor" />
      <path d="M7.57104 4.5H4.57104V7.5H7.57104V4.5Z" stroke="currentColor" />
    </svg>
  );
}
