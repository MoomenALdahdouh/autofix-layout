type Props = {
  checked: boolean
  label: string
  onToggle: () => void
}

export function Switch({ checked, label, onToggle }: Props) {
  return (
    <button
      type="button"
      className="switch"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onToggle}
    />
  )
}
