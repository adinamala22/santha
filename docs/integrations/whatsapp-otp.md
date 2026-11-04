# WhatsApp login OTP (Meta WhatsApp Cloud API)

Login codes for all three apps and the ops console's second factor can go on **WhatsApp** instead of SMS, to cut
OTP cost (an authentication template costs roughly half an Indian OTP SMS; check Meta's current rate card).
SMS stays the **fallback**: if WhatsApp can't deliver (the number isn't on WhatsApp, Meta is down, a template
problem), the same code goes by SMS. Decision: [ADR-017](../decisions/ADR-017-whatsapp-login-otp.md).

## How it is switched
| Setting | Where | Meaning |
|---|---|---|
| Feature flag **`whatsapp_otp`** | PostHog, or `flagOverrides: '{"whatsapp_otp":false}'` in the values file to switch it off | The toggle. **On by default.** Evaluated per device, so a PostHog % rollout and an instant kill switch work. Until `whatsappProvider: cloud` is set, production still sends SMS (the mock is never used there); dev/test send to the mock and log the code. |
| `whatsappProvider` | values file | `mock` (default: records messages, dev/test/fake mode) or `cloud` (Meta). Production never uses `mock`, even with the flag on: it falls back to SMS. |
| `whatsappPhoneNumberId` | values file | The sender's **Phone number ID** from WhatsApp Manager (not the number itself). |
| `whatsappOtpTemplate` | values file | Approved authentication template name, default `santha_login_otp`. |
| `WHATSAPP_ACCESS_TOKEN` | server `.env` (secret) | System User token. The backend refuses it in a values file. |

The API's `POST /v1/auth/otp/request` and `POST /v1/auth/ops/login` responses carry `channel: "whatsapp" | "sms"`,
and the apps and console say "sent on WhatsApp" (en + te) when it went there.

## One-time Meta setup
1. **Business portfolio.** business.facebook.com → create or pick the Santha business. Start **business
   verification** (Business settings → Security centre); unverified businesses can send only to a few numbers.
2. **App.** developers.facebook.com → My apps → Create app → type **Business** → add the **WhatsApp** product.
   Meta gives a test sender number and a temporary token. While testing, add the phones that should receive
   codes under API setup → **To**; other numbers fail with error 131030 (and fall back to SMS).
3. **Real sender number.** WhatsApp Manager → Phone numbers → Add: a number that is **not** registered in the
   WhatsApp or WhatsApp Business app, display name "Santha". Copy its **Phone number ID**.
4. **Template.** WhatsApp Manager → Message templates → Create template:
   - Category **Authentication**, name **`santha_login_otp`**;
   - code delivery **Copy code**, button text e.g. "Copy code";
   - tick **Add security recommendation** and set **code expiry 5 minutes** (matches `OTP_TTL_SEC=300`);
   - languages **English** and **Telugu**. If Telugu isn't approved yet, Telugu users get the English one
     (the backend retries in English on error 132001).
   Meta writes the text itself ("{{1}} is your verification code…"), so approval is usually quick.
5. **Permanent token.** Business settings → Users → **System users** → Add (role Admin) → **Assign assets**: the
   app and the WhatsApp account (full control) → **Generate token**: the app, expiry **Never**, permissions
   `whatsapp_business_messaging` and `whatsapp_business_management`. Store it only in the server's `.env`.
6. **Payment method.** WhatsApp Manager → Billing: add a card. Authentication messages are charged per message.

## Turn it on
- **Test:** in `config/values/test.values.yaml` uncomment `whatsappProvider: cloud`, `whatsappPhoneNumberId`,
  `whatsappOtpTemplate` (the flag is already on by default), add `WHATSAPP_ACCESS_TOKEN=…` to `/opt/santha/.env`, merge → deploy.
  The fixed test code `123456` stops applying once a live channel is used; real codes arrive on WhatsApp.
- **Prod:** same keys in `prod.values.yaml` + prod `.env`. Because the flag defaults on, setting
  `whatsappProvider: cloud` switches every user to WhatsApp at once; use the PostHog flag to roll back or limit to a %.

## Checking it works
- API logs: `OTP sent` with `channel` and `fallback: true|false`; `OTP channel failed` with Meta's `metaCode`.
- Common Meta codes: **131026** not deliverable (not on WhatsApp) → SMS fallback; **131030** recipient not in the
  test list; **132001** template/translation missing; **190** token expired or wrong; **131047/131056** limits.
- If WhatsApp keeps failing, turn the flag off: every OTP goes by SMS again immediately.
