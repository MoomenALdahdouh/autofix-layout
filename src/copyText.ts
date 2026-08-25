export async function copyText(text: string): Promise<boolean> {
  if (!text) return false
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return copyWithExecCommand(text)
  }
}

function copyWithExecCommand(text: string): boolean {
  const node = document.createElement('textarea')
  node.value = text
  node.setAttribute('readonly', '')
  node.style.position = 'fixed'
  node.style.top = '0'
  node.style.left = '0'
  node.style.opacity = '0'
  document.body.append(node)
  node.focus()
  node.select()
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  }
  node.remove()
  return ok
}
