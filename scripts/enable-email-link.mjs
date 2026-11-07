import { execFileSync } from 'node:child_process'

const project = process.env.FIREBASE_PROJECT_ID || 'latexide-dschroer'
const token = execFileSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8' }).trim()

const response = await fetch(
  `https://identitytoolkit.googleapis.com/admin/v2/projects/${project}/config?updateMask=signIn.email.enabled,signIn.email.passwordRequired`,
  {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Goog-User-Project': project,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      signIn: {
        email: {
          enabled: true,
          passwordRequired: false,
        },
      },
    }),
  },
)

if (!response.ok) {
  const body = await response.text()
  throw new Error(`Could not enable email-link sign-in: ${response.status} ${body}`)
}

console.log('Email-link sign-in enabled (email provider enabled, password not required).')
