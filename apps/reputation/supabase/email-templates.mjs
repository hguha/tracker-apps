/**
 * The transactional email templates, applied to the project's auth config.
 *
 *   node supabase/email-templates.mjs            # print what would change
 *   node supabase/email-templates.mjs --apply    # PATCH the project
 *
 * Needs a Supabase management token in SUPABASE_ACCESS_TOKEN, or it reads the one
 * the CLI stored in the macOS keychain.
 *
 * Design constraints, which are why this looks like 2004 HTML:
 *   - Tables, not flexbox: Outlook's renderer is Word's, and it ignores modern layout.
 *   - Inline styles only: <style> blocks and external CSS are stripped by Gmail et al.
 *   - No images or web fonts: they're blocked by default, so anything load-bearing
 *     (the code itself) has to be live text.
 *   - Dark mode is left to the client; a light card on a light page degrades safely.
 *
 * Every template is CODE-ONLY, deliberately. A link carries a redirect that depends
 * on where the request started, breaks when the mail is read on another device, and
 * on iOS can never reach an installed PWA (it opens Safari, which has its own
 * storage container). See features/auth/SignInScreen.tsx.
 */

const ACCENT = '#2a78d6'
const INK = '#0b0b0b'
const MUTED = '#6b6a66'
const LINE = '#e6e5e0'
const PAGE = '#f6f6f4'

/** One consistent shell so all three mails read as the same product. */
function shell({ heading, lead, codeLabel, footer }) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PAGE};margin:0;padding:24px 12px">
  <tr>
    <td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:440px;background:#ffffff;border:1px solid ${LINE};border-radius:14px">
        <tr>
          <td style="padding:28px 28px 0">
            <p style="margin:0;font:700 15px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;letter-spacing:.02em;color:${ACCENT}">REPutation</p>
            <h1 style="margin:14px 0 0;font:700 22px/1.25 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${INK}">${heading}</h1>
            <p style="margin:10px 0 0;font:400 15px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${MUTED}">${lead}</p>
          </td>
        </tr>
        <tr>
          <td style="padding:22px 28px 0">
            <p style="margin:0 0 8px;font:600 11px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;letter-spacing:.09em;text-transform:uppercase;color:${MUTED}">${codeLabel}</p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PAGE};border:1px solid ${LINE};border-radius:10px">
              <tr>
                <td align="center" style="padding:16px 12px">
                  <span style="font:700 30px/1 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:.24em;color:${INK}">{{ .Token }}</span>
                </td>
              </tr>
            </table>
            <p style="margin:10px 0 0;font:400 13px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${MUTED}">Type it into the app on the device you're using. It expires in an hour and works once.</p>
          </td>
        </tr>
        <tr>
          <td style="padding:22px 28px 26px">
            <div style="height:1px;background:${LINE};font-size:0;line-height:0">&nbsp;</div>
            <p style="margin:16px 0 0;font:400 12.5px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${MUTED}">${footer}</p>
          </td>
        </tr>
      </table>
      <p style="margin:16px 0 0;font:400 11.5px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${MUTED}">REPutation — log your lifts, watch the numbers move.</p>
    </td>
  </tr>
</table>`
}

export const TEMPLATES = {
  mailer_subjects_confirmation: 'Your REPutation confirmation code',
  mailer_templates_confirmation_content: shell({
    heading: 'Confirm your email',
    lead: 'Enter this code in the app to finish creating your account.',
    codeLabel: 'Confirmation code',
    footer:
      "Didn't sign up? You can ignore this email — no account is created until the code is used.",
  }),

  mailer_subjects_magic_link: 'Your REPutation sign-in code',
  mailer_templates_magic_link_content: shell({
    heading: 'Sign in to REPutation',
    lead: 'Enter this code in the app to sign in.',
    codeLabel: 'Sign-in code',
    footer:
      "Didn't try to sign in? You can ignore this email, and consider changing your password.",
  }),

  mailer_subjects_recovery: 'Your REPutation password reset code',
  mailer_templates_recovery_content: shell({
    heading: 'Reset your password',
    lead: "Enter this code in the app, then choose a new password.",
    codeLabel: 'Reset code',
    footer:
      "Didn't request this? You can ignore this email — your password stays as it is.",
  }),

  // A 6-digit code is the convention users expect and the one the copy states.
  mailer_otp_length: 6,
}

const PROJECT_REF = process.env.PROJECT_REF ?? 'orzuzeojacttsxiydwye'

async function accessToken() {
  if (process.env.SUPABASE_ACCESS_TOKEN) return process.env.SUPABASE_ACCESS_TOKEN
  const { execFileSync } = await import('node:child_process')
  const raw = execFileSync('security', [
    'find-generic-password',
    '-s',
    'Supabase CLI',
    '-w',
  ])
    .toString()
    .trim()
  const encoded = raw.replace(/^go-keyring-base64:/, '')
  return encoded === raw ? raw : Buffer.from(encoded, 'base64').toString('utf8')
}

const isApply = process.argv.includes('--apply')

if (!isApply) {
  console.log('Would set:\n')
  for (const [key, value] of Object.entries(TEMPLATES)) {
    console.log(`${key} = ${typeof value === 'number' ? value : `${value.length} chars`}`)
  }
  console.log('\nRe-run with --apply to PATCH project', PROJECT_REF)
} else {
  const token = await accessToken()
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/config/auth`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(TEMPLATES),
    },
  )
  const body = await response.json()
  if (!response.ok) {
    console.error('Failed:', body)
    process.exit(1)
  }
  const hasLink = (s) => typeof s === 'string' && s.includes('ConfirmationURL')
  console.log('Applied to', PROJECT_REF)
  console.log('  otp length:', body.mailer_otp_length)
  for (const key of [
    'mailer_templates_confirmation_content',
    'mailer_templates_magic_link_content',
    'mailer_templates_recovery_content',
  ]) {
    console.log(`  ${key}: token=${body[key]?.includes('.Token')} link=${hasLink(body[key])}`)
  }
}
