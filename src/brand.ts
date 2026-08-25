export const BRAND = {
  name: 'Layfix',
  fullName: 'Layfix',
  tagline: 'Forgot your keyboard layout? Keep typing.',
  description: 'Layfix restores text typed under the wrong keyboard layout — automatically.',
} as const

/** Page speed-box shortcut. Physical KeyL, so it still works on Arabic/Russian layouts. */
export const MANUAL_CONVERTER_SHORTCUT = 'Ctrl/⌘+Shift+L'

/** Manifest V3 command that surgically fixes the focused field. Not the speed box. */
export const DIRECT_SHORTCUT_COMMAND = 'FIX_CURRENT_TEXT'
export const DIRECT_SHORTCUT_DEFAULT_HINT = 'Ctrl/⌘+Shift+P'

export const LAYOUT_COPY: Record<
  string,
  { title: string; native: string; hint: string }
> = {
  'en-US-qwerty': {
    title: 'English',
    native: 'QWERTY',
    hint: 'Default source layout',
  },
  'ar-101': {
    title: 'Arabic',
    native: 'العربية',
    hint: 'hello ↔ اثممخ',
  },
  'ru-standard': {
    title: 'Russian',
    native: 'Русский',
    hint: 'привет ↔ ghbdtn',
  },
  'de-qwertz': {
    title: 'German',
    native: 'Deutsch',
    hint: 'yes ↔ zes',
  },
  'fr-azerty': {
    title: 'French',
    native: 'Français',
    hint: 'qwerty ↔ azerty',
  },
  'tr-q': {
    title: 'Turkish',
    native: 'Türkçe',
    hint: 'i ↔ ı',
  },
  'he-standard': {
    title: 'Hebrew',
    native: 'עברית',
    hint: 'hello ↔ יקךךם',
  },
  'el-standard': {
    title: 'Greek',
    native: 'Ελληνικά',
    hint: 'hello ↔ ηελλο',
  },
  'es-latam': {
    title: 'Spanish',
    native: 'Español',
    hint: '; ↔ ñ',
  },
  'it-standard': {
    title: 'Italian',
    native: 'Italiano',
    hint: '; ↔ ò',
  },
  'pt-abnt': {
    title: 'Portuguese',
    native: 'Português',
    hint: '; ↔ ç',
  },
  'uk-standard': {
    title: 'Ukrainian',
    native: 'Українська',
    hint: 'ЙЦУКЕН with ї / є / і',
  },
  'fa-standard': {
    title: 'Persian',
    native: 'فارسی',
    hint: 'Optional Persian keyboard',
  },
}
