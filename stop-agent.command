#!/bin/zsh
set -e

PROJECT_DIR="${0:A:h}"
cd "$PROJECT_DIR"

echo "Stopping TT2Text local agent from:"
echo "$PROJECT_DIR"
echo
npm run agent:stop
