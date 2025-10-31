# Celestia Bulletin Board

A simple web app to post messages to Celestia's DA layer via Twinkle API.

## Deploy to Netlify

[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/jcstein/t)

### Quick Deploy

1. Push to GitHub (already done!)
2. Go to https://app.netlify.com
3. Click "Add new site" → "Import an existing project"
4. Connect to GitHub and select the `t` repo
5. Click "Deploy"
6. After deployment, go to Site settings → Environment variables
7. Add variable:
   - Key: `TWINKLE_API_KEY`
   - Value: `your_twinkle_api_key_here`
8. Trigger redeploy: Deploys → Trigger deploy → Deploy site

Done! Your site will be live at `https://your-site.netlify.app`

## Local Testing

```bash
python3 -m http.server 8000
```

Open http://localhost:8000

## Features

- Post raw text messages to Celestia
- Display blob information (block height, transaction ID, commitment, etc.)
- View links to Celenium block explorer
- Netlify serverless function proxy (no CORS issues)
