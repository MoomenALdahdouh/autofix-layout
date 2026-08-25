import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ext = path.join(root, 'dist', 'chrome')
const chrome =
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = 9334
const HTTP = 8765

const CASES = [
  { id: 'keep-hello', field: 'text', type: 'word', input: 'hello', expected: 'hello ', classIfWrong: 'FALSE_POSITIVE' },
  { id: 'fix-marhaba', field: 'text', type: 'word', input: 'lvpfh', expected: 'مرحبا ', classIfWrong: 'FALSE_NEGATIVE' },
  { id: 'fix-used', field: 'text', type: 'word', input: 'hsjo]lj', expected: 'استخدمت ', classIfWrong: 'FALSE_NEGATIVE' },
  { id: 'keep-react', field: 'text', type: 'word', input: 'React', expected: 'React ', classIfWrong: 'FALSE_POSITIVE' },
  { id: 'keep-email', field: 'text', type: 'word', input: 'test@example.com', expected: 'test@example.com ', classIfWrong: 'FALSE_POSITIVE' },
  { id: 'fix-area', field: 'area', type: 'word', input: 'lvpfh', expected: 'مرحبا ', classIfWrong: 'FALSE_NEGATIVE' },
]

function serve() {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      const file = path.join(root, 'e2e', req.url === '/' ? 'page.html' : req.url.slice(1))
      try {
        const body = await readFile(file)
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        res.end(body)
      } catch {
        res.writeHead(404)
        res.end()
      }
    })
    server.listen(HTTP, '127.0.0.1', () => resolve(server))
  })
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function connect(url) {
  const ws = new WebSocket(url)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve)
    ws.addEventListener('error', reject)
  })
  let next = 1
  const pending = new Map()
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(String(event.data))
    if (msg.id && pending.has(msg.id)) pending.get(msg.id)(msg)
  })
  async function send(method, params = {}, sessionId) {
    const id = next++
    const body = { id, method, params }
    if (sessionId) body.sessionId = sessionId
    ws.send(JSON.stringify(body))
    return await new Promise((resolve) => pending.set(id, resolve))
  }
  return { ws, send }
}

async function main() {
  const profile = await mkdtemp(path.join(tmpdir(), 'layfix-e2e-'))
  const server = await serve()
  const child = spawn(
    chrome,
    [
      `--user-data-dir=${profile}`,
      `--remote-debugging-port=${PORT}`,
      `--disable-extensions-except=${ext}`,
      `--load-extension=${ext}`,
      '--disable-features=DisableLoadExtensionCommandLineSwitch',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-popup-blocking',
      `http://127.0.0.1:${HTTP}/page.html`,
    ],
    { stdio: 'ignore' },
  )

  let browser
  for (let i = 0; i < 40; i += 1) {
    await sleep(250)
    try {
      const version = await fetch(`http://127.0.0.1:${PORT}/json/version`).then((r) => r.json())
      browser = await connect(version.webSocketDebuggerUrl)
      break
    } catch {
      // chrome still starting
    }
  }
  if (!browser) {
    child.kill()
    server.close()
    console.log(JSON.stringify({ ok: false, error: 'chrome_debug_unavailable' }))
    process.exit(2)
  }

  const { send } = browser
  const pages = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json())
  const page = pages.find((item) => item.type === 'page' && item.url.includes('8765')) ?? pages.find((item) => item.type === 'page')
  const attached = await send('Target.attachToTarget', { targetId: page.id, flatten: true })
  const sessionId = attached.result.sessionId
  await send('Runtime.enable', {}, sessionId)
  await send('Page.enable', {}, sessionId)
  await send('Page.navigate', { url: `http://127.0.0.1:${HTTP}/page.html` }, sessionId)
  await sleep(1000)

  let injected = false
  for (let i = 0; i < 30; i += 1) {
    const probe = await send(
      'Runtime.evaluate',
      { expression: 'document.documentElement.dataset.autofixLayout || ""', returnByValue: true },
      sessionId,
    )
    if (probe.result?.result?.value === 'active') {
      injected = true
      break
    }
    await sleep(250)
  }

  const results = []
  for (const item of CASES) {
    await send(
      'Runtime.evaluate',
      {
        expression: `(() => { const el = document.getElementById(${JSON.stringify(item.field)}); el.focus(); if ('value' in el) el.value = ''; else el.textContent = ''; return true })()`,
        returnByValue: true,
      },
      sessionId,
    )
    await send('Input.insertText', { text: `${item.input} ` }, sessionId)
    await sleep(400)
    const read = await send(
      'Runtime.evaluate',
      {
        expression: `(() => { const el = document.getElementById(${JSON.stringify(item.field)}); return 'value' in el ? el.value : el.innerText })()`,
        returnByValue: true,
      },
      sessionId,
    )
    const actual = read.result?.result?.value ?? ''
    const pass = actual === item.expected
    results.push({
      id: item.id,
      input: item.input,
      expected: item.expected,
      actual,
      result: pass ? 'PASS' : item.classIfWrong,
      injected,
    })
  }

  child.kill()
  server.close()
  console.log(JSON.stringify({ ok: injected, injected, results }, null, 2))
  process.exit(results.every((item) => item.result === 'PASS') && injected ? 0 : 1)
}

main().catch((error) => {
  console.log(JSON.stringify({ ok: false, error: String(error) }))
  process.exit(2)
})
