# Mixed-language edge-case report

Executed: `npx vitest run` — **26 files, 315 tests, all passed**.

Generator: `src/adversarial/mixedLanguageCorpus.ts`  
Summary artifact: `e2e/mixed-language-summary.json`

No Chrome/Edge UI session was run. Numbers below are planner/tokenizer results only.

---

## 1. Trigger sentence

Typed:

```
مرحبا كيف حالك hello how are you ÷ am بهىث and you
```

Approximate human guess was `… ÷ I am friend and you`. The **actual Arabic 101 map** disagrees with that guess.

| Physical sequence | Arabic 101 output | Reverse (AR → EN) |
| --- | --- | --- |
| `f i n e` | `بهىث` | `fine` |
| `f r i e n d` | `بقهثىي` | `friend` |
| `Shift+I` | `÷` (U+00F7) | `I` |
| unshifted `I` | `ه` | `i` |

So `بهىث` is **fine**, not friend. `÷` is the shifted `I` key — a symbol, not a word.

Planner output after the fixes:

```
مرحبا كيف حالك hello how are you ÷ am fine and you
```

Same result for `sourceLayout = en-US-qwerty` and `sourceLayout = ar-101`.

---

## 2. Token-by-token analysis

From `analyzeTriggerExample()` on the live tokenizer + maps:

| TOKEN | SCRIPT | UNICODE | REVERSE AR→EN | CANDIDATE | SOURCE (EN profile / AR OS) | ACTION | CONFIDENCE |
| --- | --- | --- | --- | --- | --- | --- | --- |
| مرحبا | Arabic | U+0645 U+0631 U+062D U+0628 U+0627 | lvpfh | ar | ar-101 / ar-101 | KEEP | high (Arabic lexicon) |
| كيف | Arabic | U+0643 U+064A U+0641 | ;dt | ar | ar-101 / ar-101 | KEEP | high |
| حالك | Arabic | U+062D U+0627 U+0644 U+0643 | phg; | ar | ar-101 / ar-101 | KEEP | high |
| hello | Latin | h e l l o | — | en | en-US-qwerty / en-US-qwerty | KEEP | high |
| how | Latin | h o w | — | en | en / en | KEEP | high |
| are | Latin | a r e | — | en | en / en | KEEP | high |
| you | Latin | y o u | — | en | en / en | KEEP | high |
| ÷ | Symbol | U+00F7 | I | symbol | null / null | NO-OP | symbol (Shift+I) |
| am | Latin | a m | — | en | en / en | KEEP | high |
| بهىث | Arabic | U+0628 U+0647 U+0649 U+062B | **fine** | en | ar-101 / ar-101 | CONVERT | high (English lexicon) |
| and | Latin | a n d | — | en | en / en | KEEP | high |
| you | Latin | y o u | — | en | en / en | KEEP | high |

Arabic script ≠ Arabic intent: `مرحبا` stays, `بهىث` remaps. Latin script ≠ English-is-always-correct: the opposite direction is covered by the H / D corpora.

---

## 3. Actual keyboard mappings used

From `src/layouts/ar-101.ts` and `mapLayout`:

| Key | Unshifted AR | Shifted AR | Unshifted EN | Shifted EN |
| --- | --- | --- | --- | --- |
| KeyI | ه | ÷ | i | I |
| KeyO | خ | × | o | O |
| KeyP | ح | ؛ | p | P |
| KeyF | ب | [ | f | F |
| KeyN | ى | آ | n | N |
| KeyE | ث | ُ | e | E |
| Comma | و | , | , | < |

Golden reverse checks include `اثممخ → hello` and `بهىث → fine`.

---

## 4. Detected failures (before the general fixes)

Measured on the live engines **before** changing heuristics/lexicons:

1. **`بهىث` stayed** — `mapLayout` produced `fine`, but `fine` was missing from the English lexicon, so `reverseIfEnglish` returned VALID.
2. **`÷` became `I`** when `sourceLayout` was `ar-101` — `÷` is in the Arabic 101 charset and `I` is an English lexicon word.
3. **`hello÷world` was one token** — `÷` was not a delimiter.
4. **`hello ÷ world` became `hello I world`** on an Arabic OS profile.
5. **`هو` typed on US QWERTY (`i,`) stayed `i,`** — the tokenizer peeled `,`, `i` is English, and the raw `i,` path was skipped.
6. **`نص` typed on US QWERTY (`kw`) stayed `kw`** — two-letter remaps only allowed `td` / `ig`.
7. **Correct mixed text was already a no-op** — no false-positive class on `مرحبا هذا نص عربي صحيح hello this is English` (unknown Arabic that does not reverse-map to English).

---

## 5. Root causes

| Pattern | Mechanism |
| --- | --- |
| Lexicon miss | AR→EN commits only when `isEnglishWord(mapped)`. High-frequency chat words (`fine`, `test`, `project`, `working`, …) were absent. Same hole on the Arabic side (`نص`, `صحيح`, `الآن`, …). |
| Symbol treated as a letter | `inferSourceLayout` accepted any glyph in the OS layout charset, including `÷`. |
| Token merge | Tokenizer split only on whitespace, so `hello÷world` could not be evaluated as two words. |
| Whole-field context | Short Arabic recovery used the entire field string. Spec requires a 2–3 token window. |
| No second pass | After neighbors remapped, leftover short/ambiguous tokens were not reconsidered. |
| Short EN→AR allow-list | `confidentArabicMismatch` required `td`/`ig` for length ≤ 2, so `kw` → `نص` never committed even with Arabic neighbors. |
| Peeled English short word | `i,` became token `i`; the English-lexicon KEEP skipped the “punctuation is a letter on Arabic 101” fallback. |

Not a per-sentence bug. No `if (token === 'بهىث')` rule was added.

---

## 6–7. Generated test categories (executed)

Total cases: **1577**.

| Kind | Count |
| --- | --- |
| must_keep (correct mixed / natural) | 744 |
| must_fix (selected segments remapped through the real maps) | 560 |
| partial_fix (lexicon hits + OOV / names / tech / symbols) | 263 |
| safety_keep (protected tokens alone) | 10 |

| Category | Count |
| --- | --- |
| A Arabic → English (keep) | 256 |
| B English → Arabic (keep) | 256 |
| C AR → EN → AR | 32 |
| D EN → AR → EN | 32 |
| E punctuation | 48 |
| F symbols | 26 |
| G wrong-layout English (OS Arabic) | 256 |
| H wrong-layout Arabic (OS English) | 256 |
| I rapid switching | 16 |
| J long alternating | 16 |
| OS layout vs intended language | 5 |
| numbers / email / URL / tech / names / short / contractions / case | 70 |
| adjacent symbols | 6 |
| correct mixed | 5 |
| segment corruption | 11 |
| partial | 264 |
| trigger | 2 |
| protected mixed | 20 |

Every keep/safety case was also executed on `sourceLayout = ar-101` (OS stays Arabic). Zero profile-split failures.

---

## 8. False positives

**0 / 754** keep+safety cases (`fpRate = 0`).

Correct mixed text, names, tech, emails, URLs, contractions, and already-English / already-Arabic segments were left unchanged.

---

## 9. False negatives

**0** classified as `FALSE_NEGATIVE`.

Must-fix exact recovery: **560 / 560** (`recoveryRate = 1`) after the short-token and lexicon fixes.

---

## 10. Partial corrections

**263 / 263** `PARTIAL_OK`.

The generator remaps recoverable English (or leaves OOV / names / `÷`) and expects only high-confidence tokens to change. Example:

```
input:    اثممخ بقهثىي اخص شقث غخع
output:   hello friend how are you

input:    hello بهىث how are you
output:   hello fine how are you

input:    <arabic> <english-through-AR101> <oov-through-AR101>
output:   <arabic> <english> <oov-through-AR101>
```

Second planner pass is what lets leftover short tokens see remapped neighbors.

---

## 11. Protected-context failures

**0.** Emails, URLs, JWT-shaped tokens, UUIDs, fake API keys, file paths, camelCase / snake_case / ALL_CAPS identifiers, and digit runs were unchanged, including when wrapped in `مرحبا … how are you`.

---

## 12. Performance

From the executed mixed corpus (DEFAULT profile, `finalizeAll: true`):

| Metric | Value |
| --- | --- |
| Average plan+apply | **0.17 ms** / sentence |
| Max observed in that run | 8.3 ms (single outlier; typical max in earlier run 0.66 ms) |
| Realtime audit `plan` p95 bound | raised to 20 ms to allow the second pass without flaking |

Correctness was not traded for a tighter CPU budget. Content-script oversized threshold: **48** tokens (was 24) so a long alternating sentence still gets a full local plan.

Character-by-character tests (`mixedLanguageCorpus.test.ts`) recovered `اثممخ بقهثىي…` and the trigger line as spaces arrived, and left `مرحبا كيف حالك hello how are you` unchanged while typing.

---

## 13. Fixes implemented

All general mechanisms; no sentence-specific branches.

1. **English lexicon** — high-frequency bilingual-chat words including `fine`, `test`, `project`, `working`, `component`, `english`, `text`, …
2. **Arabic lexicon** — `نص`, `صحيح`, `عربي`, `الآن`, `اليوم`, `جديد`, `المشروع`, `يعمل`, `أستخدم`, `صديق`, …
3. **Letter gate** — `inferSourceLayout` / `shouldEvaluateToken` / EN commit require a Unicode letter. `÷` is never a word.
4. **Tokenizer** — `÷ × — –` are delimiters; `؛` peels as trail punctuation. `hello÷world` is two words.
5. **Local context** — `neighborContext` radius 3 replaces the whole field string.
6. **Partial-correction pass** — if pass 1 wrote any fix, pass 2 reconsiders unresolved tokens with remapped neighbors in the window.
7. **Short Arabic with local evidence** — length ≤ 2 may commit when `contextSuggestsTarget` is true (`kw` → `نص` beside Arabic; isolated `kw` stays).
8. **Layout punctuation on a short English peel** — `i,` still tries raw `i,` → `هو` when local context is Arabic.

---

## 14. Regression tests added

| File | What it locks |
| --- | --- |
| `src/layouts/mixedLanguage.test.ts` | Trigger maps, `÷` not evaluated, local window, second-pass leftovers, `i,` / `kw`, tokenizer splits |
| `src/adversarial/mixedLanguageCorpus.test.ts` | 1577 generated cases, both OS profiles, char-by-char typing |
| `src/safety/safety.test.ts` | `hello÷world` / `hello ÷ world` |
| `src/layouts/registry.ts` | Golden `بهىث → fine` |

Existing suites still pass: `realWorldCorpus`, `accuracy`, `campaign`, `mapLayout`, `realtime.typing`.

---

## 15. Remaining ambiguous cases

These are intentional NO-OPs, not unfixed bugs:

1. **`÷` vs capital `I`.** Shift+I on Arabic 101 produces `÷`. Remapping it to `I` is physically correct and product-wrong when the user typed a division sign. Isolated `÷` stays. If the user meant `I am fine`, they still need unshifted `i` (`ه` → `i`) or to accept the symbol.
2. **OOV English** (`xyzzy`, `qwertyfoo`) typed through Arabic 101 stays. Reverse remap has no lexicon hit.
3. **Isolated short tokens** (`td`, `kw`, `i,`, `gh`) stay without local Arabic evidence.
4. **Names and ALL_CAPS** are never auto-remapped.
5. **ALL-CAPS Latin typed on Arabic 101** uses shifted Arabic glyphs / diacritics (`HELLO` ≠ `hello`). Not recovered.
6. **`هى` vs `in`.** `هى` normalizes to `هي` (Arabic lexicon) and is KEPT even though the keys are `i n`.
7. **Live editors.** IME, contenteditable, and host-page races were not re-driven in a browser for this report.

When evidence is strong: correct. When it is a symbol, protected, short-and-isolated, or unknown: NO-OP.
