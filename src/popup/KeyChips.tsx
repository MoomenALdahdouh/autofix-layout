export function KeyChips({ keys }: { keys: readonly string[] }) {
  return (
    <span className="shortcut-chips">
      {keys.map((key) => (
        <kbd key={key}>{key}</kbd>
      ))}
    </span>
  )
}
