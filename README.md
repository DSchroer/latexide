# LaTeX IDE

A local-first LaTeX editor that compiles in your browser. No account, no server, no uploads.

**Live:** https://dschroer.github.io/latexide/

- File tree and Monaco editor
- English/German interface with a language selector; the choice is saved in `localStorage`
- Import a project from a `.zip`, including a folder wrapper
- Create and rename files; upload images into `IMAGES/`
- Compile with a WebAssembly Tectonic engine (XeTeX + BibTeX)
- PDF preview rendered with PDF.js
- Download the project as a ZIP or the compiled PDF
- Autosave to IndexedDB, with the last PDF restored on reload
- Installable PWA with an explicit “Offline” cache for the engine and packages
- GitHub Pages deployment included

## How it works

| Piece | Role |
|---|---|
| [`glyphtex-engine`](https://www.npmjs.com/package/glyphtex-engine) | Tectonic (XeTeX, xdvipdfmx, BibTeX) compiled to WebAssembly |
| Monaco | Editor, with small LaTeX and BibTeX grammars |
| PDF.js 3.11 (legacy) | PDF preview; pinned for Safari 15.6 |
| Dexie / IndexedDB | Project files and last build |
| fflate | ZIP import/export and gzip decompression |
| Workbox | App-shell precache and engine/package runtime cache |

The engine is Tectonic, not a full TeX Live installation: it ships a curated
bundle and optional package packs. The app loads the official packs on demand
and includes one project-specific pack, `public/tex-packs/thesis.tar.gz`, with
KOMA-Script, `biblatex-nature`, `upgreek`, and the other packages this thesis
needs. A missing package is reported in the Problems panel.

### Bibliography

Tectonic ships BibTeX, not Biber (Biber is Perl). Documents using
`biblatex` should use:

```latex
\usepackage[backend=bibtex,style=nature,sorting=none]{biblatex}
```

The app also patches `backend=biber` to `backend=bibtex` in the in-memory copy
for the browser build; the file in the editor and exported ZIP is unchanged.
`style=nature` works because `biblatex-nature` is in the thesis pack. If it is
not available, `style=numeric` is part of the standard references pack.

## Local development

Requires Node 20+.

```bash
npm install
npm run dev
```

`predev` copies the engine and official package packs from `node_modules` into
`public/`. Open http://127.0.0.1:5173/.

Production build:

```bash
npm run build
npm run preview
```

For a GitHub Pages-style subpath:

```bash
VITE_BASE_PATH=/latexide/ npm run build
VITE_BASE_PATH=/latexide/ npm run preview
```

## Building the thesis package pack

The committed `public/tex-packs/thesis.tar.gz` was generated on a machine with
TeX Live:

```bash
npm run thesis-pack
```

The script uses `tlmgr`/`kpsewhich` to collect KOMA-Script,
`biblatex-nature`, `hyperref`, `babel-english`, `stringenc`, `upgreek`,
`seqsplit`, `refcount`, `threeparttable`, `makecell`, `xurl`, `hyphenat`, and
Latin Modern OpenType fonts. To verify the engine and pack against the source
thesis:

```bash
npm run test:thesis
```

That script expects the thesis sources at `../as_doc` and writes
`/tmp/thesis-test.pdf`.

## Deploying to GitHub Pages

The workflow in `.github/workflows/deploy.yml` builds on every push to `main`,
sets `VITE_BASE_PATH` to the repository name, and deploys `dist/` with GitHub
Pages. In the repository settings, set Pages → Build and deployment → Source to
**GitHub Actions** (the workflow also tries to enable it through the API).

No custom headers are required: Tectonic does not need
`SharedArrayBuffer`, so GitHub Pages works without COOP/COEP.

## Browser support

- Firefox and Chromium: tested locally.
- Safari 15.6.1: targeted explicitly. The app avoids `CompressionStream`,
  `Promise.withResolvers`, regex lookbehind, and PDF.js 4.x; it uses
  `fflate` for gzip and the PDF.js legacy build. It loads `.tar.gz` payloads
  by sniffing gzip magic because some static servers send
  `Content-Encoding: gzip`.
- iOS/Safari: PDF preview is canvas-based rather than an iframe. Install via
  Share → Add to Home Screen for standalone mode and storage protection.
  Safari may evict script-writable storage after long periods without
  interaction; use the ZIP export as a backup.

## Limitations

- No Biber, `minted` (needs Python), shell escape, or system fonts.
- The curated TeX bundle does not contain every CTAN package. Add missing
  files to the thesis pack, or use one of the official package packs.
- Large projects and the first engine load take a few seconds; the engine and
  packs can be cached with the **Offline** button.

## License

The application code is MIT licensed. Tectonic is MIT; `glyphtex-engine` is
MIT. TeX Live packages in the bundle and packs retain their own licenses.
