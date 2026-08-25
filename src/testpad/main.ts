const copy = {
  en: {
    lede: 'Forgot your keyboard layout? Keep typing.',
    title: 'Type in one layout. Keep the language you meant.',
    body: 'Press Space after each word. Layfix remaps only the tokens that were typed on the wrong keyboard — English, Arabic, or Russian — and leaves real words alone.',
  },
  ar: {
    lede: 'لوحة خاطئة. كلمات صحيحة.',
    title: 'اكتب على أي تخطيط. احتفظ باللغة التي تقصدها.',
    body: 'اضغط مسافة بعد كل كلمة. Layfix يصلح الرموز المكتوبة على لوحة خاطئة فقط، ويترك الكلمات الحقيقية كما هي.',
  },
} as const

const chips = [
  { insert: 'hsjo]lj', label: 'hsjo]lj → استخدمت' },
  { insert: 'hgjwldl', label: 'hgjwldl → التصميم' },
  { insert: 'اثممخ', label: 'اثممخ → hello' },
  { insert: 'اخص شقث غخع', label: 'اخص شقث غخع → how are you' },
  { insert: 'React', label: 'React stays' },
  { insert: 'ghbdtn', label: 'ghbdtn → привет' },
]

const input = document.querySelector<HTMLInputElement>('#single')
const title = document.querySelector<HTMLElement>('#hero-title')
const body = document.querySelector<HTMLElement>('#hero-body')
const lede = document.querySelector<HTMLElement>('#lede')

function fill(target: HTMLInputElement | HTMLTextAreaElement | null, value: string): void {
  if (!target) return
  target.focus()
  target.value = `${value} `
  target.dispatchEvent(
    new InputEvent('input', {
      bubbles: true,
      composed: true,
      inputType: 'insertText',
      data: ' ',
    }),
  )
  target.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true }))
}

for (const chip of chips) {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'chip'
  const [before, after] = chip.label.split('→')
  button.append(document.createTextNode((before ?? '').trimEnd() + ' '))
  const arrow = document.createElement('b')
  arrow.textContent = '→'
  button.append(arrow)
  button.append(document.createTextNode(' ' + (after ?? '').trimStart()))
  button.addEventListener('click', () => fill(input, chip.insert))
  document.querySelector('#chips')?.append(button)
}

document.querySelectorAll<HTMLButtonElement>('[data-lang]').forEach((button) => {
  button.addEventListener('click', () => {
    const lang = button.dataset.lang === 'ar' ? 'ar' : 'en'
    document.documentElement.lang = lang
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr'
    document.querySelectorAll('[data-lang]').forEach((item) => {
      item.classList.toggle('active', item === button)
    })
    if (lede) lede.textContent = copy[lang].lede
    if (title) title.textContent = copy[lang].title
    if (body) body.textContent = copy[lang].body
  })
})
