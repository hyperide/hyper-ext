export default function IconButton({
  className = "w-6 h-6",
  ...props
}: {
  className?: string;
  [key: string]: any;
}) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" {...props}>
      <g clipPath="url(#clip0_23_7269)">
        <path
          d="M3 6C3 5.20435 3.31607 4.44129 3.87868 3.87868C4.44129 3.31607 5.20435 3 6 3H18C18.7956 3 19.5587 3.31607 20.1213 3.87868C20.6839 4.44129 21 5.20435 21 6V18C21 18.7956 20.6839 19.5587 20.1213 20.1213C19.5587 20.6839 18.7956 21 18 21H6C5.20435 21 4.44129 20.6839 3.87868 20.1213C3.31607 19.5587 3 18.7956 3 18V6Z"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M2 5C2 4.20435 2.31607 3.44129 2.87868 2.87868C3.44129 2.31607 4.20435 2 5 2H17C17.7956 2 18.5587 2.31607 19.1213 2.87868C19.6839 3.44129 20 4.20435 20 5V17C20 17.7956 20.2891 18.7708 19.5244 19.5354C18.7598 20.3001 17.7956 20 17 20H5C4.20435 20 3.44129 19.6839 2.87868 19.1213C2.31607 18.5587 2 17.7956 2 17V5Z"
          fill="white"
          stroke="currentColor"
          strokeWidth="0.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <text
          fill="#7A7A7A"
          xmlSpace="preserve"
          style={{ whiteSpace: "pre" }}
          fontFamily="SF Pro"
          fontSize="11"
          fontWeight="bold"
          letterSpacing="0px"
        >
          <tspan x="7.5" y="15.9102">
            B
          </tspan>
        </text>
      </g>
      <defs>
        <clipPath id="clip0_23_7269">
          <rect width="24" height="24" fill="white" />
        </clipPath>
      </defs>
    </svg>
  );
}
