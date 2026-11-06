#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEXMF="/usr/share/texmf-dist"
OUT="$ROOT/public/tex-packs/thesis.tar.gz"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

copy_from_tlmgr() {
  local pkg="$1"
  tlmgr info --only-files --only-installed "$pkg" 2>/dev/null \
    | sed 's/^[[:space:]]*//' \
    | while IFS= read -r file; do
        [ -n "$file" ] || continue
        file="${file#texmf-dist/}"
        case "$file" in
          */doc/*|*/source/*|*.dtx|*.ins|*.pdf|*.md|*.txt) continue ;;
        esac
        if [ -f "$TEXMF/$file" ]; then
          cp "$TEXMF/$file" "$TMP/$(basename "$file")"
        fi
      done
}

copy_kpse() {
  local name="$1"
  local file
  file="$(kpsewhich "$name" || true)"
  if [ -n "$file" ] && [ -f "$file" ]; then
    cp "$file" "$TMP/$(basename "$file")"
  else
    echo "warning: $name not found" >&2
  fi
}

# Packages the thesis needs that GlyphTeX's curated bundle does not provide.
copy_from_tlmgr koma-script
copy_from_tlmgr biblatex-nature
copy_from_tlmgr hyperref
copy_from_tlmgr babel-english
copy_from_tlmgr stringenc
copy_kpse upgreek.sty
copy_kpse seqsplit.sty
copy_kpse refcount.sty
copy_kpse threeparttable.sty
copy_kpse 3parttable.sty
copy_kpse makecell.sty
copy_kpse xurl.sty
copy_kpse hyphenat.sty

# Babel's core ships in the GlyphTeX bundle, but its language data does not.
copy_kpse british.ldf
copy_kpse english.ldf
copy_kpse UKenglish.ldf
copy_kpse USenglish.ldf
copy_kpse american.ldf
copy_kpse babel-british.tex
copy_kpse babel-english.tex

BABEL_EN="$TEXMF/tex/generic/babel/locale/en"
if [ -d "$BABEL_EN" ]; then
  find "$BABEL_EN" -maxdepth 1 -type f \( -name '*.ini' -o -name 'babel-*.tex' \) -exec cp {} "$TMP/" \;
fi

# upgreek uses the Euler fonts for upright Greek.
for dir in "$TEXMF/fonts/tfm/public/amsfonts/euler" "$TEXMF/fonts/type1/public/amsfonts/euler"; do
  if [ -d "$dir" ]; then
    find "$dir" -maxdepth 1 -type f -name 'eur*' -exec cp {} "$TMP/" \;
  fi
done

# fontspec's default family under XeTeX is Latin Modern (OpenType).
LM_DIR="$TEXMF/fonts/opentype/public/lm"
if [ -d "$LM_DIR" ]; then
  find "$LM_DIR" -maxdepth 1 -type f -name 'lm*.otf' -exec cp {} "$TMP/" \;
fi

mkdir -p "$(dirname "$OUT")"
tar -czf "$OUT" -C "$TMP" .

echo "Wrote $OUT ($(du -h "$OUT" | cut -f1) from $(find "$TMP" -type f | wc -l) files)"
