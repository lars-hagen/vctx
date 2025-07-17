#!/bin/bash

# VS Code Inspector - Installation Script
# Makes the CLI globally available

set -e

echo "🔍 Installing VS Code Context..."

# Check if Node.js is available
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is required but not installed."
    echo "Please install Node.js from https://nodejs.org"
    exit 1
fi

# Check if npm is available
if ! command -v npm &> /dev/null; then
    echo "❌ npm is required but not installed."
    exit 1
fi

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Make globally available
echo "🔗 Creating global symlink..."
npm link

echo "✅ Installation complete!"
echo ""
echo "Usage examples:"
echo "  vscode-context raw /path/to/file.js"
echo "  vscode-context open /path/to/file.js"
echo "  vscode-context --help"
echo ""
echo "For Claude users:"
echo "  Run 'vscode-context raw /path/to/current/file.js' and paste output to Claude for enhanced debugging context."