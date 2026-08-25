# Layfix design system

Layfix is a keyboard-layout recovery tool. The UI should feel calm, precise, and premium — never like an AI suite.

## Brand

- **Name:** Layfix (never LayFix, LAYFIX, or LayoutFix in UI)
- **Concept:** layout + fix
- **Line:** Forgot your keyboard layout? Keep typing.
- **Support:** Layfix restores text typed under the wrong keyboard layout — automatically.
- **Voice:** short, honest, quiet. No AI-hype.
- **Domain:** `[PRODUCTION_DOMAIN]` until one is owned. Candidates to evaluate externally: layfix.com, getlayfix.com, trylayfix.com, layfix.app, layfix.io.
- **Code identifiers** (`autofixProfile`, package `autofix-layout`) stay for compatibility. They are not the public name.

## Mark

Indigo tile + two key squares + a shift arrow (`src/ui/Mark.tsx`, `icons/icon.svg`). No letters in the icon. Sizes: 16 / 32 / 48 / 128.

## Color

| Token | Value | Use |
| --- | --- | --- |
| `--brand-primary` | `#635BFF` | CTA, active switch, selected, mark |
| `--brand-primary-hover` | `#5148E5` | Hover |
| `--brand-primary-active` | `#4338CA` | Pressed |
| `--background` | `#F8FAFC` | Canvas |
| `--surface` | `#FFFFFF` | Cards |
| `--surface-secondary` | `#F1F5F9` | Recessed |
| `--text-primary` | `#0F172A` | Headings, body |
| `--text-secondary` | `#475569` | Descriptions |
| `--text-muted` | `#64748B` | Captions |
| `--border` / `--border-strong` | `#E2E8F0` / `#CBD5E1` | Lines |
| `--success` | `#10B981` | Active only |
| `--warning` | `#F59E0B` | Low usage, never limit-reached |
| `--error` | `#EF4444` | Recoverable errors |
| `--info` | `#3B82F6` | Rare informational |

Do not paint the whole UI indigo. Green is only for a truly active status. Limit-reached is not red.

Popup surfaces are flat. Landing may use a very light indigo wash in the hero only.

## Type

`Inter, ui-sans-serif, system-ui, Segoe UI, Helvetica Neue, Noto Sans Arabic, sans-serif`

| Role | Size | Weight |
| --- | --- | --- |
| Display (site) | 36–64 | 700 |
| Heading | 16–20 | 650 |
| Body | 13 | 400 |
| Caption | 12 | 400 |
| Label | 11 | 650 |
| Button | 13 | 650 |

Line height ≥ 1.4. Mixed scripts: `dir="auto"`.

## Space, radius, shadow

Space: 4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 / 48 / 64.  
Radius: 6 / 10 / 14 / 999 (pill).  
Shadow: `0 1px 2px / 0 6px 16px` at ~5% slate. Prefer a border first.

## Components

- **Button:** indigo fill (`primary`) or lined (`ghost`). 160ms hover. No bounce.
- **Icon button:** 34×34, 10px radius. Swap label: “Swap keyboard layouts”.
- **Switch:** 44×26, `role="switch"`. Persist immediately.
- **Field / select:** white, 10px radius, indigo focus ring.
- **Card:** white, 1px border, 14px radius.
- **Status:** dot + Active / Paused / Off. Green only when active.
- **Language row:** selected layouts only. `+ Add language` for the rest.

## Popup

360px. Flat, compact. Order: header, one line, toggles, languages, converter, plan, settings, privacy. No API footer. No dashboard.

Converter: no Convert or Copy button. Result is emphasized (`--brand-soft`) and click-to-copy.

## Motion

160ms on controls. Honor `prefers-reduced-motion`. Local conversion never spins.

## Site

Light canvas, navy text, indigo CTAs. Primary: **Add Layfix — Free**. Pricing: Free $0 and Pro from `src/pricing.ts` (`$29 / year`). SEO title: `Layfix — Forgot Your Keyboard Layout? Keep Typing.`

## Legal

Document the real path: manual conversion is local; automatic classification may send a word, nearby context, a license key, and keyboard IDs. Placeholders: `[LEGAL COMPANY NAME]`, `[SUPPORT EMAIL]`, `[ADDRESS]`, `[COUNTRY]`, `[DATE]`, `[PRODUCTION_DOMAIN]`.
