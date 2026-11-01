# santha_api

Dart client for the Santha backend (`/v1`). `openapi.json` here is written by `pnpm openapi:gen`.

M0 ships hand-written models for the auth endpoints that mirror the OpenAPI schemas
(`OtpChallengeDto_Output`, `AuthSessionDto_Output`, `TokenPairDto_Output`, `MeDto_Output`).
From M1, generate the client with `openapi_generator` (dio) from `openapi.json` and keep only the
interceptors here — see ADR-001.

- `SanthaApiClient` — Dio with base URL, `X-Device-Id`, bearer token, single-flight refresh on 401.
- `AuthApi` — `requestOtp`, `verifyOtp`, `refresh`, `logout`, `me`.
- `ApiException` — typed error from the backend envelope `{ error: { code, message, details } }`.
