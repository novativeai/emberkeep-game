#!/usr/bin/env bash
set -e

corepack enable pnpm
pnpm install

# Installe Pillow (requis pour shrink-dist.py) en supprimant les alertes de Vercel
python3 -m pip install --quiet --disable-pip-version-check --root-user-action=ignore --break-system-packages pillow \
  || python3 -m pip install --quiet --disable-pip-version-check --root-user-action=ignore pillow \
  || pip3 install --quiet --root-user-action=ignore pillow
