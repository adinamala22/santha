# ADR-003: Local S3-compatible storage — RustFS instead of MinIO
2026-11-01 · Status: accepted

## Context
`docker-compose.yml` used `minio/minio` for local S3. MinIO has stopped publishing community images: `minio/minio`
and `quay.io/minio/minio` both fail to pull ("repository does not exist"), so `docker compose up` broke.
Production uses AWS S3, so this only affects dev and test.

## Decision
Use **RustFS** (`rustfs/rustfs`, Apache-2.0) for local S3. It speaks the S3 API on 9000 with a web console on 9001,
the same ports MinIO used. The compose service stays named `minio`, and `S3_*` variables in `.env.example` are unchanged.

## Consequences / when to revisit
Application code talks to S3 through the AWS SDK and must not depend on MinIO-specific admin APIs. The image tag is
`latest` for now; pin a version once the image-upload pipeline lands in M2. Revisit if RustFS proves unstable
(SeaweedFS is the fallback).
