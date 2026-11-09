interface BrandMarkProps {
  size?: number;
  className?: string;
}

export function BrandMark({ size = 24, className }: BrandMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <rect width="40" height="40" rx="11" fill="#F5E9D8" />
      <circle cx="20" cy="20.5" r="13.4" fill="#FF7140" />
      <path
        d="M 28.6 13.2 A 10.8 10.8 0 1 0 29.4 25.6"
        stroke="#2A1B13"
        strokeWidth="3.9"
        strokeLinecap="round"
      />
      <path
        d="M27.7 11.1 L31.7 16.3 L25.6 16.6 Z"
        fill="#2A1B13"
        stroke="#2A1B13"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path
        d="M17.15 14.65 L26.05 20.3 L17.15 25.95 Z"
        fill="#FFF5E8"
      />
    </svg>
  );
}
