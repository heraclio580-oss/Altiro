# Altiro email templates (Supabase Auth)

Branded versions of the emails Supabase Auth sends, in English with Spanish below (Supabase has one
template per email type, so both languages go in each). Paste them in the Supabase dashboard **on a computer** (pasted on a phone, Supabase's editor kept only the
last part of each template), and check the Preview tab shows the logo before saving:
**Authentication -> Emails -> Templates** (or **Authentication -> Email Templates**), one per tab.

| Tab | Subject | Body (paste the whole file) |
|---|---|---|
| Confirm signup | `Confirm your email for Altiro / Confirma tu correo` | `confirm-signup.html` |
| Reset Password | `Reset your Altiro password / Restablece tu contraseña` | `reset-password.html` |
| Invite user | `You're invited to Altiro / Te invitaron a Altiro` | `invite-user.html` |

`{{ .ConfirmationURL }}` and `{{ .Email }}` are filled in by Supabase -- leave them as they are. The
link goes back to the app because the Site URL / Redirect URLs are set to
https://getaltiro.app/ (Authentication -> URL Configuration).

The logo loads from the live site (`www/icons/icon-192.png`), since Gmail doesn't show images
embedded in the email itself.

Each file is only the email's visible content (a `<div>`, no `<html>`/`<head>`), plain ASCII with
accented letters as HTML codes (`&#241;` for ñ), and no hidden preview line. The first versions -- full
HTML pages with a hidden preview line -- arrived in Gmail with everything above "Button not working?"
missing.
