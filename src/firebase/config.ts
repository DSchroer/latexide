import { initializeApp, type FirebaseOptions } from 'firebase/app'
import { browserLocalPersistence, getAuth, setPersistence } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import { getStorage } from 'firebase/storage'

const firebaseConfig: FirebaseOptions = {
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? 'latexide-dschroer',
  appId: import.meta.env.VITE_FIREBASE_APP_ID ?? '1:523860155568:web:9651f31351da501b8faf75',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ?? 'latexide-dschroer.firebasestorage.app',
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? 'AIzaSyAaWmC598rChEDucJyG5L8U4EL8eAD-CIw',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? 'latexide-dschroer.firebaseapp.com',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? '523860155568',
}

export const firebaseApp = initializeApp(firebaseConfig)
export const auth = getAuth(firebaseApp)
export const cloudDb = getFirestore(firebaseApp)
export const cloudStorage = getStorage(firebaseApp, firebaseConfig.storageBucket)
void setPersistence(auth, browserLocalPersistence).catch(() => {
  // Auth still works for the current tab if persistence is unavailable.
})
