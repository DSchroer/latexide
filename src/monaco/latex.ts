import type * as Monaco from 'monaco-editor'

type MonacoApi = typeof Monaco

function hasLanguage(monaco: MonacoApi, id: string): boolean {
  return monaco.languages.getLanguages().some((language) => language.id === id)
}

export function registerLatex(monaco: MonacoApi): void {
  if (hasLanguage(monaco, 'latex')) return

  monaco.languages.register({ id: 'latex', extensions: ['.tex', '.ltx', '.cls', '.sty'] })
  monaco.languages.setLanguageConfiguration('latex', {
    comments: { lineComment: '%' },
    brackets: [
      ['{', '}'],
      ['[', ']'],
      ['(', ')'],
    ],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '$', close: '$' },
    ],
    surroundingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
    ],
  })

  monaco.languages.setMonarchTokensProvider('latex', {
    tokenizer: {
      root: [
        [/%.*$/, 'comment'],
        [/\\(?:begin|end)\s*\{[^}]*\}/, 'keyword.control'],
        [/\\(?:documentclass|usepackage|input|include|includegraphics|bibliography|addbibresource|printbibliography|cite|ref|label|section|subsection|chapter|caption|text[a-zA-Z]*|mathrm|mathbf|mathit|frac|sum|int)\b/, 'keyword'],
        [/\\[a-zA-Z@]+\*?/, 'tag'],
        [/\$\$?/, 'string'],
        [/[{}]/, 'delimiter.bracket'],
        [/[\[\]]/, 'delimiter.square'],
        [/\d+(?:\.\d+)?/, 'number'],
        [/[&~^_]/, 'operator'],
      ],
    },
  })
}

export function registerBibtex(monaco: MonacoApi): void {
  if (hasLanguage(monaco, 'bibtex')) return

  monaco.languages.register({ id: 'bibtex', extensions: ['.bib'] })
  monaco.languages.setLanguageConfiguration('bibtex', {
    comments: { lineComment: '%' },
    brackets: [
      ['{', '}'],
      ['(', ')'],
    ],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '"', close: '"' },
    ],
  })

  monaco.languages.setMonarchTokensProvider('bibtex', {
    tokenizer: {
      root: [
        [/%.*$/, 'comment'],
        [/@[a-zA-Z]+/, 'keyword'],
        [/[a-zA-Z][\w-]*(?=\s*=)/, 'attribute.name'],
        [/[{}]/, 'delimiter.bracket'],
        [/"[^"]*"/, 'string'],
        [/\d+/, 'number'],
      ],
    },
  })
}
