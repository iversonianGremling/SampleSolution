# AUR Packaging (`sample-solution-bin`)

This folder contains a binary AUR package scaffold for distributing the Linux AppImage from GitHub Releases.

## Files

- `PKGBUILD`: package definition for `sample-solution-bin`
- `calc-sha256.sh`: helper to calculate SHA256 for a local file or remote URL
- `update-pkgbuild.sh`: updates `pkgver`, `pkgrel`, `_asset_name`, `sha256sums`, and regenerates `.SRCINFO`

## Update package metadata from a release

From repo root:

```bash
./packaging/aur/update-pkgbuild.sh --version 0.1.0
```

Optional flags:

```bash
./packaging/aur/update-pkgbuild.sh \
  --version 0.1.0 \
  --owner iversonianGremling \
  --repo SampleSolution \
  --pkgrel 1
```

If the release has multiple Linux assets, pick an exact one:

```bash
./packaging/aur/update-pkgbuild.sh --version 0.1.0 --asset linux-Sample-Extractor-0.1.0.AppImage
```

## Manual SHA256 calculation

```bash
./packaging/aur/calc-sha256.sh ./path/to/file.AppImage
./packaging/aur/calc-sha256.sh https://example.com/file.AppImage
```

## Build/test locally on Arch

```bash
cd packaging/aur
makepkg -si
```

## Publish to AUR

```bash
git clone ssh://aur@aur.archlinux.org/sample-solution-bin.git /tmp/sample-solution-bin
cp packaging/aur/PKGBUILD /tmp/sample-solution-bin/
cp packaging/aur/.SRCINFO /tmp/sample-solution-bin/
cd /tmp/sample-solution-bin
git add PKGBUILD .SRCINFO
git commit -m "sample-solution-bin: update to 0.1.0-1"
git push
```
