import { useCallback, useEffect, useState } from 'react'
import {
  isSignInWithEmailLink,
  onAuthStateChanged,
  sendSignInLinkToEmail,
  signInWithEmailLink,
  signOut as firebaseSignOut,
  type ActionCodeSettings,
  type User,
} from 'firebase/auth'
import { auth } from '../firebase/config'

function readStoredEmail(): string {
  try {
    return localStorage.getItem('latexide.emailForSignIn') ?? ''
  } catch {
    return ''
  }
}

function storeEmail(email: string): void {
  try {
    localStorage.setItem('latexide.emailForSignIn', email)
  } catch {
    // Private browsing can reject storage.
  }
}

function clearStoredEmail(): void {
  try {
    localStorage.removeItem('latexide.emailForSignIn')
  } catch {
    // Ignore.
  }
}

function cleanAuthQuery(): void {
  const url = new URL(window.location.href)
  for (const key of ['apiKey', 'oobCode', 'mode', 'continueUrl', 'lang', 'tenantId']) {
    url.searchParams.delete(key)
  }
  window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`)
}

export function useAuth() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [magicLinkSent, setMagicLinkSent] = useState(false)
  const [needsLinkEmail, setNeedsLinkEmail] = useState(false)
  const [initialEmail, setInitialEmail] = useState(readStoredEmail)

  const actionCodeSettings = useCallback((): ActionCodeSettings => ({
    url: `${window.location.origin}${import.meta.env.BASE_URL}`,
    handleCodeInApp: true,
  }), [])

  const completeMagicLink = useCallback(async (email?: string) => {
    const href = window.location.href
    if (!isSignInWithEmailLink(auth, href)) return

    const targetEmail = email?.trim() || readStoredEmail()
    if (!targetEmail) {
      setNeedsLinkEmail(true)
      return
    }

    setError(null)
    setLoading(true)
    try {
      await signInWithEmailLink(auth, targetEmail, href)
      clearStoredEmail()
      setNeedsLinkEmail(false)
      setMagicLinkSent(false)
      cleanAuthQuery()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    return onAuthStateChanged(
      auth,
      (nextUser) => {
        setUser(nextUser)
        setLoading(false)
      },
      (reason) => {
        setError(reason instanceof Error ? reason.message : String(reason))
        setLoading(false)
      },
    )
  }, [])

  useEffect(() => {
    if (!isSignInWithEmailLink(auth, window.location.href)) return
    const stored = readStoredEmail()
    if (stored) {
      void completeMagicLink(stored)
    } else {
      setNeedsLinkEmail(true)
      setLoading(false)
    }
  }, [completeMagicLink])

  const sendMagicLink = async (email: string) => {
    const target = email.trim()
    if (!target) {
      setError('Enter your email address.')
      return
    }
    setError(null)
    try {
      await sendSignInLinkToEmail(auth, target, actionCodeSettings())
      storeEmail(target)
      setInitialEmail(target)
      setMagicLinkSent(true)
      setNeedsLinkEmail(false)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  const signOut = async () => {
    await firebaseSignOut(auth)
  }

  return {
    user,
    loading,
    error,
    signOut,
    sendMagicLink,
    completeMagicLink,
    magicLinkSent,
    needsLinkEmail,
    initialEmail,
  }
}
