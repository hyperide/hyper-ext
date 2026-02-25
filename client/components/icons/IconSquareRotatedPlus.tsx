export default function IconSquareRotatedPlus({
  className = "w-3.5 h-3.5",
  ...props
}: {
  className?: string;
  [key: string]: any;
}) {
  return (
    <svg className={className} viewBox="0 0 14 14" fill="none" {...props}>
      <g clipPath="url(#clip0_icon_square_rotated_plus)">
        <path
          d="M5.25 7H8.75"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M7 5.25V8.75"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M7.84351 1.51671L12.4839 6.15654C12.7076 6.38026 12.8333 6.68367 12.8333 7.00004C12.8333 7.31641 12.7076 7.61983 12.4839 7.84354L7.84351 12.484C7.6198 12.7077 7.31638 12.8333 7.00001 12.8333C6.68364 12.8333 6.38023 12.7077 6.15651 12.484L1.5161 7.84354C1.29239 7.61983 1.16672 7.31641 1.16672 7.00004C1.16672 6.68367 1.29239 6.38026 1.5161 6.15654L6.15651 1.51613C6.38023 1.29242 6.68364 1.16675 7.00001 1.16675C7.31638 1.16675 7.6198 1.29301 7.84351 1.51671Z"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
      <defs>
        <clipPath id="clip0_icon_square_rotated_plus">
          <rect width="14" height="14" fill="white" />
        </clipPath>
      </defs>
    </svg>
  );
}
