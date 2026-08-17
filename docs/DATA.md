# Data and backup behavior

**English** · [简体中文](./DATA_CN.md)

[Documentation](./README.md) · [Security](./SECURITY.md) ·
[Deployment](./DEPLOYMENT.md) · [Image generation](./IMAGE_GENERATION.md) ·
[Project home](../README.md)

## Browser storage

IndexedDB is the source of truth for conversations, message branches,
attachments, non-sensitive settings, model capability overrides, and metadata.
Model, search, and image-generation credentials are stored in separate
credential records so ordinary search, export, and backup paths do not read
them.

The current browser schema is version 7. Its migration removes the retired
per-conversation `contextMessageLimit` and `advancedSettings` properties while
preserving conversation identity, Assistant snapshots, active-model state,
messages, branches, attachments, web-search state, and image-generation message
parts.

If IndexedDB cannot open, CherryChat creates an in-page memory database for chat
history and uses localStorage only for the current connection bundle. A visible
warning explains that chats will disappear after refresh or close. Images and
message history are not forced into localStorage.

## Deletion actions

- Deleting one chat removes every branch and releases only attachments that no
  remaining message references.
- Clearing all chats removes all conversations, branches, and attachments while
  preserving credentials and settings.
- Clearing all local data deletes the CherryChat database, every
  `cherrychat.*` localStorage key, in-memory previews, and the hosted session
  cookie. It does not clear unrelated sites or unrelated localStorage keys.
- Archiving changes visibility only; it does not delete messages or images.

All destructive UI actions require explicit browser confirmation.

## Full backup

The version 2 ZIP format contains `backup.json` plus independent attachment
files. The manifest includes all branches, image metadata, non-sensitive
settings, and capability overrides. It excludes API Keys, access codes, cookies,
and credential digests. New archives omit the retired conversation properties;
existing version 2 archives that contain them remain readable and the importer
discards those properties after validating their legacy shape.

Image-generation messages retain a snapshot of the model, connection Scope,
size, quality, output format, compression, and ordered reference attachment IDs.
Backup v2 includes those snapshots plus referenced and generated image
attachments. Import remaps reference attachment IDs together with the other
message and attachment references; image API Keys remain excluded and must be
entered again.

Full backups also retain validated provider continuation context required for
stateless replay, including separately owned DeepSeek, GLM, Qwen, and Kimi Chat
`reasoning_content`. GLM context is created only for explicit retained thinking;
Qwen context is created only for Qwen3.8 while thinking is not Off; Kimi K3
always retains its structured reasoning. DeepSeek/GLM require tool-call history,
while Qwen3.8/Kimi also preserve ordinary no-tool turns. Every Chat owner is
limited to five steps, 1 MiB per text block, and 4 MiB of text per Assistant
message. These hidden parts survive ID remapping, but ordinary JSON, Markdown,
print, copy, search, and rendered message output omit them.

Import validates the format version, schema, per-entity counts, JSON depth and
node limits, file count, compressed and expanded size limits, safe paths,
reference completeness, acyclic message trees, image MIME types, and SHA-256
hashes before writing. Message-tree validation is linear in the number of
messages rather than repeatedly walking every parent chain. Imported IDs are
remapped and the merge runs in one Dexie transaction, so invalid or failed
imports do not partly overwrite existing data. Credentials must be entered
again.

## Single-chat export

- JSON preserves all message branches, roles, models, usage, image-generation
  snapshots, and attachment metadata.
- Markdown exports the current branch. Chats with images produce a ZIP whose
  Markdown uses relative paths for referenced and generated image attachments
  rather than IndexedDB URLs or large Base64 values.
- Print preview renders the current branch with PDF-friendly styles.

All three export paths use the same reasoning projection. Reasoning is excluded
by default and included only when the user enables the export option.

## Compatibility

The IndexedDB schema version and backup format version are independent. Database
migrations are tested from legacy fixtures and must preserve message parts and
attachment references. Published backup versions require compatible readers;
they must not be silently overwritten by an incompatible format.

Database version 7 therefore does not require Backup version 3: the current
Backup v2 reader accepts the two known legacy properties, strips them before the
write transaction, and continues to reject every other unknown conversation
property.

## Security note

Browser storage is scoped to the current browser profile, not encrypted by
CherryChat, and not synchronized by the project. Treat a full backup as private
conversation data even though credentials are excluded. Review imported files
before sharing them and keep browser profiles protected by the operating system.
