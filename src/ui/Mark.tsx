type MarkProps = {
  size?: number
}

/** Geometric key-shift mark. Readable at 16px. No wordmark inside. */
export function Mark({ size = 28 }: MarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 128 128"
      fill="none"
      aria-hidden="true"
      className="mark"
    >
      <rect width="128" height="128" rx="28" fill="#635BFF" />
      <rect x="22" y="40" width="46" height="46" rx="10" fill="#FFFFFF" fillOpacity="0.28" />
      <rect x="54" y="40" width="52" height="48" rx="12" fill="#FFFFFF" />
      <path
        d="M40 64h28"
        stroke="#635BFF"
        strokeWidth="7"
        strokeLinecap="round"
      />
      <path
        d="M60 52l16 12-16 12"
        stroke="#635BFF"
        strokeWidth="7"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  )
}
