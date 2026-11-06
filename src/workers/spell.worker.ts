/// <reference lib="webworker" />
import nspell, { type Nspell } from 'nspell'

type SpellLanguage = 'en' | 'de'
type Issue = { word: string; start: number; end: number }

type Incoming =
  | { type: 'init'; baseUrl: string }
  | { type: 'check'; id: number; text: string; language: SpellLanguage }

type Outgoing =
  | { type: 'result'; id: number; issues: Issue[] }
  | { type: 'error'; id: number; message: string }

const ctx = self as unknown as DedicatedWorkerGlobalScope
let baseUrl = ''
const engines = new Map<SpellLanguage, Promise<Nspell>>()

async function fetchText(path: string): Promise<string> {
  const response = await fetch(new URL(path, baseUrl))
  if (!response.ok) throw new Error(`Could not load ${path} (${response.status})`)
  return response.text()
}

function getSpell(language: SpellLanguage): Promise<Nspell> {
  const existing = engines.get(language)
  if (existing) return existing

  const loading = (async () => {
    const [aff, dic] = await Promise.all([
      fetchText(`dictionaries/${language}.aff`),
      fetchText(`dictionaries/${language}.dic`),
    ])
    return nspell(aff, dic)
  })()

  engines.set(language, loading)
  loading.catch(() => engines.delete(language))
  return loading
}

const blank = (match: string) => ' '.repeat(match.length)

/**
 * Replace LaTeX syntax, math, citations, URLs and file names with spaces while
 * preserving character offsets, so the spell checker only sees prose.
 */
function maskLatex(text: string): string {
  let masked = text
  masked = masked.replace(/%.*$/gm, blank)
  masked = masked.replace(/\$\$[\s\S]*?\$\$|\$[^$\n]*\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)/g, blank)
  masked = masked.replace(
    /\\(?:cite[a-zA-Z]*|nocite|ref|eqref|autoref|pageref|label|includegraphics|input|include|bibliography|addbibresource|url|href|begin|end|verb)\*?(?:\[[^\]]*\])?\{[^}]*\}/g,
    blank,
  )
  masked = masked.replace(/\\[a-zA-Z@]+\*?/g, blank)
  masked = masked.replace(/\b(?:https?:\/\/|www\.)\S+/gi, blank)
  masked = masked.replace(/\S+@\S+/g, blank)
  masked = masked.replace(/\b[\w./-]+\.(?:tex|bib|png|jpe?g|pdf|svg|eps|sty|cls|bst)\b/gi, blank)
  return masked
}

function checkText(text: string, language: SpellLanguage, spell: Nspell): Issue[] {
  const masked = maskLatex(text)
  const wordPattern = /[A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß'’-]*/g
  const issues: Issue[] = []
  let match: RegExpExecArray | null

  while ((match = wordPattern.exec(masked)) !== null) {
    const word = match[0]
    if (word.length < 3) continue
    if (/\d/.test(word)) continue
    if (word.length > 1 && word === word.toUpperCase()) continue
    // English proper nouns and acronyms are noisy in scientific prose; German
    // nouns are capitalised as a matter of grammar, so only apply this to en.
    if (language === 'en' && /^[A-Z]/.test(word)) continue
    if (spell.correct(word.replace(/’/g, "'"))) continue

    issues.push({ word, start: match.index, end: match.index + word.length })
    if (issues.length >= 500) break
  }

  return issues
}

ctx.onmessage = async (event: MessageEvent<Incoming>) => {
  const message = event.data
  if (message.type === 'init') {
    baseUrl = message.baseUrl
    return
  }

  if (message.type === 'check') {
    try {
      const spell = await getSpell(message.language)
      const issues = checkText(message.text, message.language, spell)
      const response: Outgoing = { type: 'result', id: message.id, issues }
      ctx.postMessage(response)
    } catch (error) {
      const response: Outgoing = {
        type: 'error',
        id: message.id,
        message: error instanceof Error ? error.message : String(error),
      }
      ctx.postMessage(response)
    }
  }
}
