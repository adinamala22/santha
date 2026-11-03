# ADR-016: Test environment on a laptop through a Cloudflare Tunnel

- Status: accepted
- Date: 2026-11-03

## Context
Oracle Cloud Always Free sign-up failed for us, and a paid or trial VM is not set up yet. Testers still need
test reachable from their phones over HTTPS at fixed addresses, because the website and the test apps have the
API address built in.

## Decision
Test can run on a developer's computer (WSL 2 on Windows, or Linux), using the same `compose.yml`, `santha.sh`
and values files as a VM. A new overlay `config/values/laptop.test.values.yaml` sets `deploy.ingress: tunnel`, and
`santha.sh` then adds `compose.tunnel.yml`:
- Caddy publishes no ports and serves plain HTTP inside the compose network;
- `cloudflared` opens an outbound Cloudflare Tunnel, and Cloudflare serves HTTPS on the usual test hostnames;
- Caddy trusts private-range proxies so the client IP survives, and the backend uses `TRUST_PROXY=2`.

`infra/deploy/laptop/laptop.sh` builds the images locally instead of pulling them from GitHub Packages.
`test-env.ps1` keeps WSL running on Windows. Domains stay in `test.values.yaml`, so moving test to a VM later
only means changing DNS. We chose a named tunnel (token) over free `trycloudflare.com` quick tunnels: quick tunnels
get new random addresses on every restart, so the website and the apps would need rebuilding each time.

## Consequences
- ₹0, no open ports, works behind NAT. The domain's DNS must be on Cloudflare (free plan).
- Test is down whenever the computer is off, asleep or signed out. That's fine for a few testers, not for a pilot.
- Test data sits on the developer's disk with no automatic backups. Test has demo data only; real users stay on prod.
