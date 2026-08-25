# Edge target

Output: `dist/edge`

Microsoft Edge desktop uses the Chromium extension model. This target is the same source and the same Manifest V3 package as Chrome. The product name remains **Layfix**.

```bash
npm run build:edge
```

Load unpacked from `dist/edge` at `edge://extensions`. Development steps: [`EDGE_DEVELOPMENT.md`](../../EDGE_DEVELOPMENT.md).
