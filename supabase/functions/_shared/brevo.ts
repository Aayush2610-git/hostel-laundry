// One recipient per Brevo request, always. `to` here is a single object,
// not an array — that's deliberate, so nothing upstream can accidentally
// batch multiple residents into one call. Brevo's `to` array puts every
// address on it in every recipient's headers, which would leak the whole
// waitlist's emails to each other.
export async function sendOfferEmail(
  to: { email: string; name: string },
  subject: string,
  htmlContent: string,
): Promise<void> {
  const apiKey = Deno.env.get('BREVO_API_KEY')
  const senderEmail = Deno.env.get('BREVO_SENDER_EMAIL')
  const senderName = Deno.env.get('BREVO_SENDER_NAME') ?? 'Hostel Laundry'

  if (!apiKey || !senderEmail) {
    console.error('BREVO_API_KEY / BREVO_SENDER_EMAIL not set — skipping email to', to.email)
    return
  }

  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': apiKey,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      sender: { email: senderEmail, name: senderName },
      to: [{ email: to.email, name: to.name }],
      subject,
      htmlContent,
    }),
  })

  if (!res.ok) {
    console.error(`Brevo send to ${to.email} failed: ${res.status} ${await res.text()}`)
  }
}
