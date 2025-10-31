# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Simple static web app that posts messages to Celestia's DA layer via Twinkle API. Pure HTML/CSS/JS - no build tools, no frameworks.

## Files

- **index.html**: Main page with post form and results display
- **app.js**: Twinkle API integration, posts blobs and displays responses
- **style.css**: Styling
- **.github/workflows/deploy.yml**: GitHub Actions workflow that injects API key and deploys to Pages

## How It Works

1. User types message
2. Message converted to hex
3. Posted to Twinkle API as blob on Celestia Mocha-4 testnet
4. Display transaction info (block height, tx ID, commitment, explorer links)

## Local Development

Just open `index.html` in a browser, or:

```bash
python3 -m http.server 8000
```

**CORS proxy**: Uses `corsproxy.io` on localhost to bypass CORS restrictions. Automatically disabled on production.

## Deployment

GitHub Actions workflow handles deployment:
1. Replaces `PLACEHOLDER_API_KEY` with `secrets.TWINKLE_API_KEY`
2. Deploys to GitHub Pages

**Required Secret**: `TWINKLE_API_KEY` must be set in repo secrets

## API Response Structure

```json
{
  "twinkleRequestId": "...",
  "blockHeight": 8638899,
  "celestiaTransactionId": "...",
  "blockExplorer": {
    "transaction": "https://mocha-4.celenium.io/tx/...",
    "block": "https://mocha-4.celenium.io/block/..."
  },
  "gasFeeUsdCents": 1,
  "commitment": "..."
}
```

## Future Additions

- Supabase integration for message history
- Display list of all posted messages
