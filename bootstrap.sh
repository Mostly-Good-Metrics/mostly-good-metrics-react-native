#!/bin/bash
# Bootstrap script for react-native-sdk (npm)
set -e

echo "Bootstrapping react-native-sdk..."

# Install tools via mise (Node)
mise install

# Copy .env.sample to .env if it exists and .env doesn't
if [ -f ".env.sample" ] && [ ! -f ".env" ]; then
  cp .env.sample .env
  echo "Created .env from .env.sample"
fi

# Install npm dependencies
npm install

echo "Done! React Native SDK is ready."
