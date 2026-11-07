import { useEffect, useState } from 'react'
import {
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut as firebaseSignOut,
  type User,
} from 'firebase/auth'
import { auth, googleProvider } from '../firebase/config'

export function useAuth() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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

  const signIn = async () => {
    setError(null)
    try {
      await signInWithPopup(auth, googleProvider)
    } catch (reason) {
      const code = (reason as { code?: string })?.code
      if (code === 'auth/popup-blocked' || code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        await signInWithRedirect(auth, googleProvider)
        return
      }
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  const signOut = async () => {
    await firebaseSignOut(auth)
  }

  return { user, loading, error, signIn, signOut }
}
