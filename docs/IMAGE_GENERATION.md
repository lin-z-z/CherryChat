# Image generation

**English** · [简体中文](./IMAGE_GENERATION_CN.md)

[Documentation](./README.md) · [Deployment](./DEPLOYMENT.md) ·
[Model compatibility](./MODEL_COMPATIBILITY.md) · [Security](./SECURITY.md) ·
[Data behavior](./DATA.md) · [Project home](../README.md)

CherryChat can generate an image from a prompt or edit one with ordered
reference images. The feature uses an OpenAI-compatible Images API and stores
the completed image with the conversation in the current browser.

![CherryChat image generation](./images/cherrychat-image-generation.png)

## Capability boundary

CherryChat sends one image request at a time and expects one result. Text-only
requests use `POST /v1/images/generations`; requests with references use
`POST /v1/images/edits` with repeated, ordered `image[]` fields.

The built-in BYOK profile uses model `gpt-image-2`. An OpenAI-compatible label
does not guarantee that every provider supports the same sizes, reference
images, quality values, output formats, or response fields. Confirm the
provider's Images compatibility and account access before relying on it.

## Quick start

1. Open **Settings -> Model service** and select **Custom API** for BYOK or
   **Use access code** for Hosted access.
2. Open **Settings -> Image generation**.
3. For BYOK, enter the image service URL and API Key, then save. For Hosted
   access, choose from the profiles exposed by the deployment operator.
4. Return to the conversation and use the image icon to switch the composer
   from text chat to image generation.
5. Enter a prompt, optionally add reference images, choose the available size,
   quality, and output controls, then send.

Image mode has its own ordered reference draft and does not reuse ordinary chat
attachments. Switching back to chat leaves normal chat attachment limits and
behavior unchanged.

## BYOK connection

BYOK image settings contain one service URL and one API Key. The model is fixed
to `gpt-image-2`; local model IDs and profile management are intentionally not
exposed.

- The default service URL shown by the client is `https://api.openai.com`.
- Enter the service root or a URL ending in `/v1`. Do not enter the complete
  `/v1/images/generations` or `/v1/images/edits` path.
- Requests go directly from the browser to the configured service, so the
  provider must allow the CherryChat origin through CORS.
- The API Key is stored in a separate browser credential record and is excluded
  from backups and conversation exports.

The checked-in URL and model are UI defaults, not free project credentials.
Each BYOK user supplies and pays for their own provider account.

## Hosted connection

Hosted image generation is optional and requires complete Hosted access
configuration. The browser receives only profile IDs, names, model IDs, and
size modes. Deployment API Keys and upstream URLs stay server-side.

### Single Hosted profile

Use the legacy trio for one deployment-funded profile:

```env
IMAGE_GENERATION_API_KEY=replace-with-image-provider-key
IMAGE_GENERATION_BASE_URL=https://api.openai.com
IMAGE_GENERATION_MODEL=gpt-image-2
```

All three values are required together and have no runtime fallback. Omitting
the complete group disables Hosted image generation.

### Multiple Hosted profiles

Use `IMAGE_GENERATION_PROFILES` instead of the legacy trio. It is a JSON array
of 1 through 32 strict objects:

```json
[
  {
    "id": "standard",
    "name": "Standard",
    "apiKey": "replace-with-image-provider-key",
    "baseUrl": "https://api.openai.com",
    "model": "gpt-image-2",
    "sizeMode": "auto"
  }
]
```

Profile IDs must be unique. `IMAGE_GENERATION_DEFAULT_PROFILE` defaults to the
first profile ID and, when set, must match a configured profile. Valid
`sizeMode` values are `auto`, `fixed`, and `custom`. The JSON list cannot be
combined with any variable from the legacy trio.

See [Deployment and connection modes](./DEPLOYMENT.md) for the complete Hosted
access group, environment defaults, Vercel steps, and public deployment checks.

## Generate or edit an image

- A non-empty prompt and an available image profile are required.
- Up to 16 PNG, JPEG, WebP, HEIC, or HEIF references can be added and
  reordered. HEIC/HEIF input is converted before the request; reference order
  is preserved in the multipart body and in the saved generation snapshot.
- **Stop** cancels the active request. A failed, stopped, or completed attempt
  remains part of the conversation so retry uses the original profile,
  parameters, connection scope, and reference order.
- A completed result is stored as a local image attachment. It can be
  downloaded or reused as a reference without copying its underlying blob.

## Profiles and parameters

| Control       | Default | Contract                                                  |
| ------------- | ------- | --------------------------------------------------------- |
| Resolution    | `1K`    | Resolves to `1024x1024` with the default ratio.           |
| Aspect ratio  | `1:1`   | Additional ratios depend on the selected profile.         |
| Quality       | `auto`  | Other values are `low`, `medium`, and `high`.             |
| Output format | `png`   | Other values are `jpeg` and `webp`.                       |
| Compression   | None    | Available for JPEG/WebP as an integer from 0 through 100. |
| References    | None    | At most 16 ordered images.                                |

Profiles with `sizeMode=custom` expose custom sizes. `sizeMode=auto` exposes
them only for the exact `gpt-image-2` model ID; `fixed` keeps the compatible
fixed-size controls. CherryChat normalizes custom dimensions to bounded,
16-pixel-aligned values, but the upstream provider still decides whether a
normalized size is supported.

## Data, backup, and export

Image service settings, generation parameters, message snapshots, references,
and generated outputs are browser-local data. A generation snapshot records
the model, connection scope, size, quality, format, compression, and ordered
reference IDs so reload and retry do not silently use new global settings.

Backup v2 includes the generation snapshot and referenced/generated image
attachments, remapping attachment IDs during import. It excludes BYOK image
API Keys, access codes, cookies, and deployment credentials. JSON conversation
exports retain message metadata; Markdown exports with images produce a ZIP
that uses relative attachment paths.

See [Data and backup behavior](./DATA.md) before moving or sharing archives.

## Security and limits

- Browser BYOK sends the image API Key directly to the configured absolute
  service URL. CherryChat does not silently proxy a failed CORS request.
- Hosted browsers call only same-origin `POST /api/image-generation` after
  same-origin and signed-session validation. The server selects the complete
  allowlisted profile and rejects redirects.
- Hosted image requests default to an 8 MiB body limit and a 300-second
  timeout. Operators can change these with the documented environment
  variables. The process-local Hosted image concurrency limit is 2.
- A generated image is limited to 20 MiB and the parsed response to 32 MiB.
  Hosted response URLs must share the configured upstream origin and are
  downloaded without credentials or redirects before image validation.
- Public Hosted deployments still require upstream spending controls and an
  abuse-response plan. The process-local guard is not a global quota or billing
  ledger.

See [Security policy and model](./SECURITY.md) for the full trust boundary.

## Troubleshooting

- **Image mode is unavailable:** save a BYOK image API Key, or ask the operator
  to configure at least one Hosted image profile.
- **The browser cannot reach the service:** verify the Base URL and provider
  CORS policy. Use a root or `/v1` URL, not a complete Images endpoint.
- **Unauthorized or forbidden:** confirm account access to the image model and
  re-enter the BYOK Key. Hosted users cannot replace deployment credentials.
- **Profile or parameters unavailable:** select an exposed Hosted profile and
  use controls supported by its `sizeMode` and model ID.
- **Request too large:** reduce the number or dimensions of references. Hosted
  deployments may use a lower request limit than browser BYOK.
- **Timeout or untrusted result:** retry only after checking provider status and
  deployment logs. Hosted rejects cross-origin result URLs and redirects by
  design.
