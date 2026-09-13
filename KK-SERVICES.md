# Provisioning — approved Resend and private Railway bucket

## Resend
- Create account at https://resend.com/signup (user handles password and terms).
- Add a sending domain/subdomain owned by the organizer and verify the exact DNS records Resend supplies. Do not replace existing mail DNS records.
- Free: 100 messages/day, insufficient for 180 participants logging in on one day. Pricing checked 2026-09-13: Pro $20/month, 50,000 messages, no daily cap. User must approve/perform subscription before event.
- Server variables: RESEND_API_KEY, KK_EMAIL_FROM (verified sender), KK_AUTH_SECRET (stable strong random secret).
- No live code has been sent yet. Tests replace the external request with a stub.

## Railway
- Existing project f25f20dc-b414-4f09-9e5a-a6a9d0619de7, production df9d02d9-f722-4529-af06-b080a5f9c817.
- Bucket kilometerkampioen-media, ID 790a9546-50e1-4c6b-8130-9408e5645f23, created/staged on 2026-09-13 in existing US East region.
- A pre-existing PKP_API_KEY change is also staged. No Deploy Changes clicked, so no unrelated change was applied.
- Configure these variable REFERENCES in live-board, not literal credentials in Git:
  KK_S3_BUCKET = ${{kilometerkampioen-media.BUCKET}}
  KK_S3_ENDPOINT = ${{kilometerkampioen-media.ENDPOINT}}
  KK_S3_ACCESS_KEY_ID = ${{kilometerkampioen-media.ACCESS_KEY_ID}}
  KK_S3_SECRET_ACCESS_KEY = ${{kilometerkampioen-media.SECRET_ACCESS_KEY}}
  KK_S3_REGION = ${{kilometerkampioen-media.REGION}}
- Check the Credentials tab's URL style; set KK_S3_PATH_STYLE=true only when instructed there.
- Private S3 adapter added, not exposed as an upload endpoint yet. File signature, video duration, stream limits, ownership and quota validation must be implemented before enabling uploads.
- No object uploaded or credentials exposed in app code. Real S3 integration still needs verification after provisioning.

GitHub clone/read works; git push failed for lack of credentials. Local commits remain available in codex/kilometerkampioen.
