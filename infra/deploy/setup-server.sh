#!/usr/bin/env bash
# One-time preparation of a fresh Ubuntu 22.04/24.04 server (x86 or ARM) for Santha. Run as a sudo user:
#   curl -fsSL https://raw.githubusercontent.com/<owner>/santha/main/infra/deploy/setup-server.sh | sudo bash
#   (or copy the file over and run: sudo bash setup-server.sh)
# Installs Docker, creates the `deploy` user and /opt/santha, opens 80/443 in the host firewall (Oracle Cloud's
# Ubuntu images block them with iptables by default), and adds swap on small machines. Safe to run again.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Run with sudo." >&2; exit 1; }

echo "== Docker"
if ! command -v docker >/dev/null; then curl -fsSL https://get.docker.com | sh; fi
systemctl enable --now docker

echo "== deploy user and /opt/santha"
id deploy >/dev/null 2>&1 || adduser --disabled-password --gecos "" deploy
usermod -aG docker deploy
install -d -o deploy -g deploy -m 750 /opt/santha /home/deploy/.ssh
touch /home/deploy/.ssh/authorized_keys && chown deploy: /home/deploy/.ssh/authorized_keys && chmod 600 /home/deploy/.ssh/authorized_keys

echo "== firewall: allow 80 and 443"
if command -v iptables >/dev/null && iptables -S INPUT 2>/dev/null | grep -q -- '-j REJECT'; then
  # Oracle images end INPUT with a REJECT rule; insert ours before it and persist.
  for port in 80 443; do
    iptables -C INPUT -p tcp --dport "$port" -j ACCEPT 2>/dev/null || iptables -I INPUT 5 -p tcp --dport "$port" -j ACCEPT
  done
  iptables -C INPUT -p udp --dport 443 -j ACCEPT 2>/dev/null || iptables -I INPUT 5 -p udp --dport 443 -j ACCEPT
  if command -v netfilter-persistent >/dev/null; then netfilter-persistent save; fi
fi
if command -v ufw >/dev/null && ufw status | grep -q active; then ufw allow 22/tcp; ufw allow 80/tcp; ufw allow 443; fi

echo "== swap (machines under 8 GB)"
mem_gb=$(awk '/MemTotal/ {print int($2/1024/1024)}' /proc/meminfo)
if [ "$mem_gb" -lt 8 ] && ! swapon --show | grep -q .; then
  fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "== automatic security updates"
apt-get install -y -qq unattended-upgrades >/dev/null && dpkg-reconfigure -f noninteractive unattended-upgrades >/dev/null || true

cat <<'EOF'

Done. Next:
  1. Add the deploy public key:      sudo -u deploy tee -a /home/deploy/.ssh/authorized_keys   (paste, then Ctrl-D)
  2. Create the secrets file:        sudo -u deploy nano /opt/santha/.env      (template: infra/deploy/server.env.example)
                                     sudo chmod 600 /opt/santha/.env
  3. In the cloud console, allow inbound TCP 80 and 443 (Oracle: VCN → Security List → Ingress rules).
  4. Point the DNS names at this server's public IP (docs/deploy/README.md), then push to main.
EOF
