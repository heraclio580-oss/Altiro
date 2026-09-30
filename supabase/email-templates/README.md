# Altiro email templates (Supabase Auth)

Branded versions of the emails Supabase Auth sends, in English with Spanish below (Supabase has one
template per email type, so both languages go in each). Paste them in the Supabase dashboard:
**Authentication -> Emails -> Templates** (or **Authentication -> Email Templates**), one per tab.

| Tab | Subject | Body (paste the whole file) |
|---|---|---|
| Confirm signup | `Confirm your email for Altiro / Confirma tu correo` | `confirm-signup.html` |
| Reset Password | `Reset your Altiro password / Restablece tu contraseña` | `reset-password.html` |
| Invite user | `You're invited to Altiro / Te invitaron a Altiro` | `invite-user.html` |

`{{ .ConfirmationURL }}` and `{{ .Email }}` are filled in by Supabase -- leave them as they are. The
link goes back to the app because the Site URL / Redirect URLs are set to
https://heraclio580-oss.github.io/Altiro/ (Authentication -> URL Configuration).

The logo loads from the live site (`www/icons/icon-192.png`), since Gmail doesn't show images
embedded in the email itself.
