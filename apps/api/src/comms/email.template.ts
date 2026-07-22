/**
 * Branded transactional email template (Module 22).
 *
 * The HTML is inlined as a string constant rather than read from disk so it
 * resolves correctly from the compiled `dist/` output with no file-copy step
 * in the build. It mirrors `deploy/email-template.html` — keep the two in sync
 * if the design changes. Merge vars are substituted by `renderBrandedEmail`.
 */

export interface BrandedEmail {
  /** Bold headline at the top of the card. */
  heading: string;
  /** Body copy (plain text; newlines become spaced paragraphs). */
  body: string;
  /** CTA button label, e.g. "Reset password". Omit to hide the button. */
  buttonLabel?: string;
  /** CTA button URL. Required when buttonLabel is set. */
  buttonUrl?: string;
  /** Inbox preview text. Falls back to the heading. */
  preheader?: string;
  /** Unsubscribe / manage-notifications link. */
  unsubscribeUrl?: string;
}

const TEMPLATE = `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <title>StackUp</title>
  <!--[if mso]>
  <style>
    * { font-family: Arial, Helvetica, sans-serif !important; }
  </style>
  <![endif]-->
  <style>
    body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { -ms-interpolation-mode: bicubic; border: 0; height: auto; line-height: 100%; outline: none; text-decoration: none; }
    body { margin: 0; padding: 0; width: 100% !important; height: 100% !important; }
    a { color: #7b68ee; }
    .btn:hover { background: #5b45d6 !important; }
    @media only screen and (max-width: 600px) {
      .container { width: 100% !important; }
      .px { padding-left: 24px !important; padding-right: 24px !important; }
      .h1 { font-size: 24px !important; line-height: 32px !important; }
    }
    @media (prefers-color-scheme: dark) {
      .bg { background: #0e0f14 !important; }
      .card { background: #171922 !important; }
      .ink { color: #f4f4f7 !important; }
      .muted { color: #a5a6b3 !important; }
      .divider { border-color: #2a2c39 !important; }
      .wordmark { color: #f4f4f7 !important; }
    }
  </style>
</head>
<body class="bg" style="margin:0; padding:0; background-color:#f4f2fb;">
  <div style="display:none; max-height:0; overflow:hidden; mso-hide:all; font-size:1px; line-height:1px; color:#f4f2fb; opacity:0;">
    {{preheader}}
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="bg" style="background-color:#f4f2fb;">
    <tr>
      <td align="center" style="padding:28px 12px 40px;">

        <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" class="container card" style="width:560px; max-width:560px; background-color:#ffffff; border-radius:16px; overflow:hidden; box-shadow:0 6px 24px rgba(20,18,45,0.08);">

          <tr>
            <td class="px" style="padding:26px 40px 6px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="vertical-align:middle;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="display:inline-block; vertical-align:middle;">
                      <tr>
                        <td width="36" height="36" align="center" valign="middle" style="width:36px; height:36px; background-color:#7b68ee; border-radius:9px; text-align:center;">
                          <img src="https://raw.githubusercontent.com/simboni/smp-planning/claude/clickup-recreation-9vk6m2/deploy/stackup-mark.png" width="20" height="20" alt="" style="display:block; border:0;">
                        </td>
                      </tr>
                    </table>
                  </td>
                  <td style="vertical-align:middle; padding-left:10px;">
                    <span class="wordmark ink" style="font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:20px; font-weight:800; letter-spacing:-0.3px; color:#1a1a2e;">Stack<span style="color:#7b68ee;">Up</span></span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td class="px" style="padding:22px 40px 8px;">
              <h1 class="h1 ink" style="margin:0 0 14px; font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:26px; line-height:34px; font-weight:800; letter-spacing:-0.4px; color:#1a1a2e;">
                {{heading}}
              </h1>
              <div class="muted" style="margin:0 0 12px; font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:15px; line-height:1.65; color:#5b5c6b;">
                {{body}}
              </div>
            </td>
          </tr>

          {{button_block}}

          <tr>
            <td class="px" style="padding:22px 40px 0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr><td class="divider" style="border-top:1px solid #ecebf4; font-size:0; line-height:0;">&nbsp;</td></tr>
              </table>
            </td>
          </tr>

          <tr>
            <td class="px" style="padding:18px 40px 30px;">
              <p class="muted" style="margin:0 0 6px; font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:12px; line-height:1.6; color:#9a9ba8;">
                You're receiving this because you have a StackUp account.
              </p>
              <p class="muted" style="margin:0; font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:12px; line-height:1.6; color:#9a9ba8;">
                &copy; StackUp &middot; <a href="https://www.stackup.co.ke" style="color:#9a9ba8; text-decoration:underline;">stackup.co.ke</a>{{unsubscribe}}
              </p>
            </td>
          </tr>

        </table>

        <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" class="container" style="width:560px; max-width:560px;">
          <tr>
            <td align="center" style="padding:18px 20px 0;">
              <p class="muted" style="margin:0; font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:12px; color:#a7a8b5;">
                One app to plan, track, and get work done.
              </p>
            </td>
          </tr>
        </table>

      </td>
    </tr>
  </table>
</body>
</html>`;

const BUTTON_BLOCK = `<tr>
            <td class="px" align="left" style="padding:14px 40px 8px;">
              <!--[if mso]>
              <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="{{button_url}}" style="height:46px;v-text-anchor:middle;width:220px;" arcsize="20%" strokecolor="#7b68ee" fillcolor="#7b68ee">
                <w:anchorlock/>
                <center style="color:#ffffff;font-family:Arial,sans-serif;font-size:15px;font-weight:bold;">{{button_label}}</center>
              </v:roundrect>
              <![endif]-->
              <!--[if !mso]><!-- -->
              <a href="{{button_url}}" class="btn" style="display:inline-block; background-color:#7b68ee; color:#ffffff; font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:15px; font-weight:700; text-decoration:none; padding:14px 30px; border-radius:10px;">
                {{button_label}}
              </a>
              <!--<![endif]-->
            </td>
          </tr>

          <tr>
            <td class="px" style="padding:14px 40px 4px;">
              <p class="muted" style="margin:0; font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:13px; line-height:1.6; color:#8a8b99;">
                Or copy and paste this link into your browser:<br>
                <a href="{{button_url}}" style="color:#7b68ee; word-break:break-all;">{{button_url}}</a>
              </p>
            </td>
          </tr>`;

/** Minimal HTML-escape for values interpolated into the template. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Escape a URL for an href attribute (quotes only — keep it clickable). */
function escUrl(s: string): string {
  return s.replace(/"/g, "%22").replace(/</g, "%3C").replace(/>/g, "%3E");
}

/**
 * Render the branded HTML email by substituting merge vars. Body text is
 * escaped and split on blank lines into spaced paragraphs. Returns a complete,
 * inline-styled HTML document ready to hand to Resend as `html`.
 */
export function renderBrandedEmail(m: BrandedEmail): string {
  const paragraphs = m.body
    .split(/\n{2,}/)
    .map((p) => esc(p.trim()).replace(/\n/g, "<br>"))
    .filter((p) => p.length > 0)
    .join('</div><div class="muted" style="margin:12px 0 0; font-family:\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif; font-size:15px; line-height:1.65; color:#5b5c6b;">');

  let buttonBlock = "";
  if (m.buttonLabel && m.buttonUrl) {
    buttonBlock = BUTTON_BLOCK.replace(/\{\{button_url\}\}/g, escUrl(m.buttonUrl)).replace(
      /\{\{button_label\}\}/g,
      esc(m.buttonLabel),
    );
  }

  const unsubscribe = m.unsubscribeUrl
    ? ` &middot; <a href="${escUrl(m.unsubscribeUrl)}" style="color:#9a9ba8; text-decoration:underline;">Unsubscribe</a>`
    : "";

  return TEMPLATE.replace(/\{\{preheader\}\}/g, esc(m.preheader || m.heading))
    .replace(/\{\{heading\}\}/g, esc(m.heading))
    .replace(/\{\{body\}\}/g, paragraphs)
    .replace(/\{\{button_block\}\}/g, buttonBlock)
    .replace(/\{\{unsubscribe\}\}/g, unsubscribe);
}

/** Plain-text fallback derived from the branded fields (for `text` part). */
export function brandedText(m: BrandedEmail): string {
  const parts = [m.heading, "", m.body];
  if (m.buttonLabel && m.buttonUrl) {
    parts.push("", `${m.buttonLabel}: ${m.buttonUrl}`);
  }
  parts.push("", "— StackUp · stackup.co.ke");
  return parts.join("\n");
}
