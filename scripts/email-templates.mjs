// Writes Supabase Auth's email templates from supabase/functions/_shared/email.ts, so the
// sign-in emails match the rest (docs/self-hosting.md). Run: npm run email:templates
import { writeFileSync, mkdirSync } from "node:fs";
import { renderEmail } from "../supabase/functions/_shared/email.ts";

mkdirSync("supabase/templates", { recursive: true });
for (const [kind, file] of [
  ["magic_link", "magic_link.html"],
  ["confirm_signup", "confirmation.html"],
]) {
  const e = renderEmail(kind, { link: "{{ .ConfirmationURL }}" });
  writeFileSync(`supabase/templates/${file}`, e.html);
  console.log(`supabase/templates/${file}  subject: ${e.subject}`);
}
