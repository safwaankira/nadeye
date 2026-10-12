#!/usr/bin/env sh
# Validate DESIGN.md (structure, token references, WCAG contrast) and refresh the exports.
set -e
cd "$(dirname "$0")/.."
npx -y @google/design.md@0.4.0 lint DESIGN.md
npx -y @google/design.md@0.4.0 export --format json-tailwind DESIGN.md > design/tailwind.config.json
npx -y @google/design.md@0.4.0 export --format css-tailwind DESIGN.md > design/tailwind-theme.css
npx -y @google/design.md@0.4.0 export --format dtcg DESIGN.md > design/tokens.dtcg.json
