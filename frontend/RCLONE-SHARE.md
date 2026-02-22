# Rclone Share Library System

This project now includes a versioned shared-library system built on top of `rclone`.

## What it does

- Publishes local library folders as versioned snapshots to an `rclone` remote
- Maintains a remote manifest (`index.json`) of all libraries and versions
- Pulls one library (or syncs all latest libraries) to local storage

## Setup

1. Install `rclone`:

```bash
rclone version
```

2. Create local config from the example (optional in backend Docker, where auto-setup is enabled by default):

```bash
cp rclone-share.config.example.json rclone-share.config.json
```

3. Update `rclone-share.config.json`:

```json
{
  "remote": ":local:./rclone-share-remote",
  "basePath": "sample-share",
  "localLibraryRoot": "./shared-libraries",
  "rcloneBinary": "rclone"
}
```

- `remote`: either an rclone alias (`myremote`) or a full root (`:local:/path/to/share-root`)
- `basePath`: folder prefix inside the remote
- `localLibraryRoot`: default local destination for pulls/syncs

## Commands

All commands run through:

```bash
npm run rclone:share -- <command> [options]
```

## Frontend trigger

You can run these operations from the app UI:

- Open **Settings** tab
- Go to **Shared Libraries**
- Run:
  - **Initialize Remote**
  - **Publish**
  - **Pull**
  - **Sync Latest**

The frontend uses backend endpoints under `/api/tools/rclone-share/*`, which execute `scripts/rclone-share.mjs`.

### Initialize remote structure

```bash
npm run rclone:share -- init
```

Creates:
- `<remote>:<basePath>/libraries/`
- `<remote>:<basePath>/index.json` (if missing)

### Publish a library version

```bash
npm run rclone:share -- publish --name drums --source ./my-drums
```

Optional:

```bash
npm run rclone:share -- publish --name drums --source ./my-drums --version v1.2.0 --note "new transient edits"
```

### List libraries

```bash
npm run rclone:share -- list
npm run rclone:share -- list --name drums
npm run rclone:share -- list --json
```

### Pull one library

```bash
npm run rclone:share -- pull --name drums
npm run rclone:share -- pull --name drums --version v1.2.0
npm run rclone:share -- pull --name drums --target ./local-drums
```

### Sync all latest libraries

```bash
npm run rclone:share -- sync
npm run rclone:share -- sync --target-root ./team-libraries
```

## Remote layout

```text
<remote>:<basePath>/
  index.json
  libraries/
    <library-name>/
      <version>/
        ...files
```

## Notes

- `publish` rejects duplicate versions per library.
- `pull` and `sync` mirror remote state with `rclone sync` (extra local files in target folders are removed).
- `pull` and `sync` create `.rclone-share.json` in each destination folder with sync metadata.
- If your shell cannot find `rclone`, set `"rcloneBinary"` in config to an absolute path.
