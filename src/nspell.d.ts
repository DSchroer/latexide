declare module 'nspell' {
  export interface Nspell {
    correct(word: string): boolean
    suggest(word: string): string[]
  }

  export default function nspell(aff: string | Uint8Array, dic: string | Uint8Array): Nspell
}
