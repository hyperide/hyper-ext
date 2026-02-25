export default function IconFlexRow({
  className = 'w-5 h-5',
  ...props
}: {
  className?: string;
  [key: string]: unknown;
}) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 20 20" fill="none" {...props}>
      <g clipPath="url(#clip0_18_314)">
        <path
          d="M4.58329 4.16669C4.47279 4.16669 4.36681 4.21059 4.28866 4.28873C4.21052 4.36687 4.16663 4.47285 4.16663 4.58335V7.91669C4.16663 8.02719 4.21052 8.13317 4.28866 8.21131C4.36681 8.28945 4.47279 8.33335 4.58329 8.33335H7.91663C8.02713 8.33335 8.13311 8.28945 8.21125 8.21131C8.28939 8.13317 8.33329 8.02719 8.33329 7.91669V4.58335C8.33329 4.47285 8.28939 4.36687 8.21125 4.28873C8.13311 4.21059 8.02713 4.16669 7.91663 4.16669H4.58329Z"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M12.0833 4.16669C11.9728 4.16669 11.8668 4.21059 11.7887 4.28873C11.7105 4.36687 11.6666 4.47285 11.6666 4.58335V7.91669C11.6666 8.02719 11.7105 8.13317 11.7887 8.21131C11.8668 8.28945 11.9728 8.33335 12.0833 8.33335H15.4166C15.5271 8.33335 15.6331 8.28945 15.7113 8.21131C15.7894 8.13317 15.8333 8.02719 15.8333 7.91669V4.58335C15.8333 4.47285 15.7894 4.36687 15.7113 4.28873C15.6331 4.21059 15.5271 4.16669 15.4166 4.16669H12.0833Z"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M12.5 11.6667L15 14.1667L12.5 16.6667"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path d="M15 14.1667H5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      <defs>
        <clipPath id="clip0_18_314">
          <rect width="20" height="20" fill="white" />
        </clipPath>
      </defs>
    </svg>
  );
}
