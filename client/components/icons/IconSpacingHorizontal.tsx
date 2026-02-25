export default function IconSpacingHorizontal({
  className = 'w-3 h-3',
  ...props
}: {
  className?: string;
  [key: string]: unknown;
}) {
  return (
    <svg className={className} viewBox="0 0 12 12" fill="none" {...props}>
      <title>Horizontal Spacing</title>
      <path
        d="M11 10H10C9.73478 10 9.48043 9.89464 9.29289 9.70711C9.10536 9.51957 9 9.26522 9 9V3C9 2.73478 9.10536 2.48043 9.29289 2.29289C9.48043 2.10536 9.73478 2 10 2H11"
        stroke="#7A7A7A"
        strokeWidth="1"
        strokeLinejoin="round"
      />
      <path
        d="M1 10H2C2.26522 10 2.51957 9.89464 2.70711 9.70711C2.89464 9.51957 3 9.26522 3 9V3C3 2.73478 2.89464 2.48043 2.70711 2.29289C2.51957 2.10536 2.26522 2 2 2H1"
        stroke="#7A7A7A"
        strokeWidth="1"
        strokeLinejoin="round"
      />
      <path d="M6 4V8" stroke="#7A7A7A" strokeWidth="1" strokeLinejoin="round" />
    </svg>
  );
}
