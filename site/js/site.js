import { SITE } from './config.js'
import { clientHintBrands, preferredStoreButtons } from './browser.js'

const path = location.pathname.split('/').pop() || 'index.html'

const nav = [
  ['index.html', 'Product'],
  ['pricing.html', 'Pricing'],
  ['privacy.html', 'Privacy'],
  ['terms.html', 'Terms'],
  ['refund.html', 'Refunds'],
  ['support.html', 'Support'],
]

function mark() {
  return `<svg class="mark" width="28" height="28" viewBox="0 0 128 128" fill="none" aria-hidden="true">
    <rect width="128" height="128" rx="28" fill="#635BFF"/>
    <rect x="22" y="40" width="46" height="46" rx="10" fill="#FFFFFF" fill-opacity="0.28"/>
    <rect x="54" y="40" width="52" height="48" rx="12" fill="#FFFFFF"/>
    <path d="M40 64h28" stroke="#635BFF" stroke-width="7" stroke-linecap="round"/>
    <path d="M60 52l16 12-16 12" stroke="#635BFF" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  </svg>`
}

const header = document.querySelector('[data-header]')
if (header) {
  header.innerHTML = `
    <div class="wrap bar">
      <a class="brand" href="index.html">${mark()}<span>Layfix</span></a>
      <nav aria-label="Primary">
        ${nav
          .map(([href, label]) => `<a href="${href}"${href === path ? ' aria-current="page"' : ''}>${label}</a>`)
          .join('')}
      </nav>
    </div>`
}

const footer = document.querySelector('[data-footer]')
if (footer) {
  footer.innerHTML = `
    <div class="wrap foot-grid">
      <div>
        <p class="brand">${mark()}<span>Layfix</span></p>
        <p class="muted">You forgot to switch your keyboard. Layfix has you covered.</p>
      </div>
      <div>
        <p class="tiny">Product</p>
        <a href="index.html">Home</a>
        <a href="pricing.html">Pricing</a>
        <a href="support.html">Support</a>
      </div>
      <div>
        <p class="tiny">Legal</p>
        <a href="privacy.html">Privacy</a>
        <a href="terms.html">Terms</a>
        <a href="refund.html">Refund Policy</a>
      </div>
    </div>
    <p class="wrap legal">© ${new Date().getFullYear()} ${SITE.companyName}. Layfix is a keyboard-layout utility, not a translator. ${SITE.productionDomain}</p>`
}

document.querySelectorAll('[data-price]').forEach((node) => {
  node.textContent = SITE.proPriceLabel
})

const storeUrls = {
  chrome: SITE.chromeStoreUrl,
  edge: SITE.edgeStoreUrl,
}

function applyStoreLink(node, browser) {
  const url = storeUrls[browser]
  if (url) node.setAttribute('href', url)
}

document.querySelectorAll('[data-install]').forEach((node) => {
  applyStoreLink(node, preferredStoreButtons(clientHintBrands())[0])
})

document.querySelectorAll('[data-install-chrome]').forEach((node) => {
  applyStoreLink(node, 'chrome')
})

document.querySelectorAll('[data-install-edge]').forEach((node) => {
  applyStoreLink(node, 'edge')
})

const installGroup = document.querySelector('[data-install-group]')
if (installGroup) {
  const order = preferredStoreButtons(clientHintBrands())
  const chromeBtn = installGroup.querySelector('[data-install-chrome]')
  const edgeBtn = installGroup.querySelector('[data-install-edge]')
  if (chromeBtn && edgeBtn) {
    chromeBtn.classList.toggle('primary', order[0] === 'chrome')
    chromeBtn.classList.toggle('ghost', order[0] !== 'chrome')
    edgeBtn.classList.toggle('primary', order[0] === 'edge')
    edgeBtn.classList.toggle('ghost', order[0] !== 'edge')
  }
}

document.querySelectorAll('[data-checkout]').forEach((node) => {
  if (SITE.checkoutUrl) node.setAttribute('href', SITE.checkoutUrl)
})
