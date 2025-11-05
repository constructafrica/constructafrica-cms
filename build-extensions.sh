#!/bin/bash

# Build script for Directus extensions bundle in Docker environment
# This script builds a single bundle extension from multiple sources

set -e  # Exit on error

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Source and destination directories
SOURCE_DIR="$SCRIPT_DIR/src-extensions"
OUTPUT_DIR="$SCRIPT_DIR/extensions"
BUNDLE_NAME="directus-extension-bundle"

echo "=========================================="
echo "Building Directus Extensions Bundle"
echo "=========================================="
echo ""

# Check if src-extensions directory exists
if [ ! -d "$SOURCE_DIR" ]; then
    echo "❌ Error: src-extensions directory not found!"
    echo "Please create $SOURCE_DIR and add your extension source code"
    exit 1
fi

# Navigate to source directory
cd "$SOURCE_DIR"

# Install dependencies if node_modules doesn't exist
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
fi

# Build the bundle
echo "Building extensions bundle..."
npm run build

# Clean and prepare output directory
echo "Preparing output directory..."
rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR/$BUNDLE_NAME"

# Copy built files
echo "Copying built files to extensions directory..."

if [ -d "dist" ]; then
    cp -r dist "$OUTPUT_DIR/$BUNDLE_NAME/"
    echo "✓ Copied dist folder"
else
    echo "❌ Error: No dist folder found after build"
    exit 1
fi

if [ -f "package.json" ]; then
    cp package.json "$OUTPUT_DIR/$BUNDLE_NAME/"
    echo "✓ Copied package.json"
else
    echo "❌ Error: No package.json found"
    exit 1
fi

echo ""
echo "=========================================="
echo "Build Summary"
echo "=========================================="
echo "Source directory: $SOURCE_DIR"
echo "Output directory: $OUTPUT_DIR"
echo "Bundle name: $BUNDLE_NAME"
echo ""
echo "Structure:"
echo "  $OUTPUT_DIR/"
echo "    └── $BUNDLE_NAME/"
echo "        ├── dist/"
echo "        │   ├── app.js"
echo "        │   └── api.js"
echo "        └── package.json"
echo ""
echo "=========================================="
echo "✓ Bundle built successfully!"
echo "=========================================="
echo ""
echo "Next steps:"
echo "1. Make sure your docker-compose.yml mounts the extensions directory:"
echo "   volumes:"
echo "     - ./extensions:/directus/extensions"
echo ""
echo "2. Restart your Directus container:"
echo "   docker compose down && docker compose up -d"
echo ""