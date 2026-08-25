# Layfix — Edge Add-ons release

Chrome and Edge ship the same version from `manifest.json`. Do not invent a second version number.

Current version: **0.1.0**

Store URL until the listing exists: `[EDGE_ADDONS_URL]`

## Build command

```bash
npm test
npm run lint
VITE_API_BASE_URL=https://[API_PRODUCTION_DOMAIN] npm run build:all
```

Or Edge only:

```bash
VITE_API_BASE_URL=https://[API_PRODUCTION_DOMAIN] npm run build:edge
```

## Output folder

```text
dist/edge
```

Confirm `dist/edge/manifest.json` is Manifest V3 and the name is **Layfix**.

## Version update

1. Change `version` in `manifest.json` (one value for both browsers).
2. Rebuild Chrome and Edge.
3. Do not bump only one store.

## Package generation

```bash
npm run pack:edge
```

Creates `store/layfix-edge.zip` from `dist/edge`. That zip is gitignored.

Scan the unzipped package for `GROQ_API_KEY`, `LEMON_SQUEEZY_API_KEY`, and `gsk_` before upload.

## Store upload preparation

Partner Center fields: [`site/STORE_LISTING.md`](site/STORE_LISTING.md).

- Name: Layfix
- Short description: Forgot to switch your keyboard? Layfix restores the text you meant to type.
- Category: Productivity
- Website / support / privacy: `[WEB_PRODUCTION_DOMAIN]` pages
- Icon: `store/icon-300.png`
- Privacy text must match the Chrome listing (automatic mode may send a word to the API / Groq)

## Screenshots

Manual. See `store/README.md`. Use Edge window chrome if the browser frame is visible.

## Privacy declarations

Copy from `site/STORE_LISTING.md` and `site/privacy.html`.

State clearly:

- Manual conversion is local
- Automatic correction may send one word, short nearby context, layout IDs, and a license key
- The page, URL, and history are not sent
- Groq is used only to classify layout mismatch

## Permissions declarations

Explain each permission in plain language (same as Chrome):

| Permission | Why |
| --- | --- |
| storage | Save keyboards, toggles, local cache, trial/usage, license key |
| activeTab | Skip / work with the page you are looking at |
| clipboardWrite | Copy manual-converter output when you click it |
| Host access to pages | Read supported text fields after a word finishes |
| API host | Call the Layfix API only |

Do not add extra permissions for Edge.

## Release checklist

- [ ] `npm test` and `npm run lint` pass
- [ ] `npm run build:chrome` still succeeds
- [ ] `npm run build:edge` succeeds
- [ ] Manifest name is Layfix, version matches Chrome
- [ ] Zip does not contain secrets
- [ ] Privacy copy matches the implementation
- [ ] Support / privacy / website URLs are the same as Chrome
- [ ] `EXTENSION_IDS` includes the published Edge ID **and** Chrome ID when you pin origins
- [ ] Partner Center upload
- [ ] Listing URL recorded as the real `[EDGE_ADDONS_URL]`

## Rollback / update

Upload the previous zip (same or previous version as Partner Center allows). There is no separate Edge backend to roll back. If only the extension changed, keep the API as-is.

## License note

Pro is a Lemon Squeezy license key stored in that browser profile’s extension storage. The same key works on Edge if the user pastes it. There is no extra Edge license system and no invented account sync.
