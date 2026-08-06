# Model catalogue sources

`model-catalog.json` is generated from the public
[models.dev models dataset](https://models.dev/models.json) and
[provider dataset](https://models.dev/api.json). The source project is
`anomalyco/models.dev` and is distributed under the MIT license.

The generated file contains only capability fields consumed by CherryChat.
Entries without a positive context-window value are skipped rather than given
an invented default. The snapshot does not contain model prices, descriptions,
benchmarks, API keys, or provider configuration. CherryChat reads the checked-in
snapshot at runtime and never contacts models.dev from the browser.

Refresh the snapshot with:

```powershell
npm.cmd run models:update
```

Review the generated diff and run the model capability tests before committing
an update. High-confidence manual corrections in `model-capabilities.ts` take
priority over the generated catalogue.
