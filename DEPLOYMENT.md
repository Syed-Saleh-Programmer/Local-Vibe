# 🚀 LocalVibe — Deployment Guide

Deploy this monorepo (client + server) from a **single GitHub repository** using **Vercel** (frontend) and **Render** (backend).

---

## 📁 Repository Structure

```
CircleMe/
├── client/          ← React + Vite (deployed to Vercel)
│   ├── src/
│   ├── .env.example
│   ├── package.json
│   └── vite.config.js
├── server/          ← Node.js + Express + Socket.IO (deployed to Render)
│   ├── index.js
│   └── package.json
├── .gitignore
└── DEPLOYMENT.md
```

---

## Step 1 — Push to GitHub

```bash
cd D:\Coding\CircleMe
git init
git add .
git commit -m "Initial commit — LocalVibe conferencing app"
git remote add origin https://github.com/YOUR_USERNAME/CircleMe.git
git push -u origin main
```

---

## Step 2 — Deploy the Server on Render

> [!IMPORTANT]
> The server MUST be deployed first, because the client needs the server URL as an environment variable.

### 2.1 Create the Service

1. Go to [render.com](https://render.com) and sign in
2. Click **"New +"** → **"Web Service"**
3. Connect your GitHub repo (`CircleMe`)
4. Configure:

| Setting | Value |
|---------|-------|
| **Name** | `circleme-server` (or any name) |
| **Region** | Choose closest to your users |
| **Root Directory** | `server` |
| **Runtime** | Node |
| **Build Command** | `npm install` |
| **Start Command** | `npm start` |
| **Instance Type** | Free (or Starter for always-on) |

### 2.2 Add Environment Variables

In the Render dashboard → **Environment** tab:

| Key | Value |
|-----|-------|
| `CLIENT_URL` | `https://your-app-name.vercel.app` |
| `NODE_ENV` | `production` |

> [!NOTE]
> You'll come back and update `CLIENT_URL` after deploying the client in Step 3. For now, you can set it to `*` temporarily.

### 2.3 Deploy

Click **"Create Web Service"**. Wait for the build to finish.

Your server URL will be something like:
```
https://circleme-server.onrender.com
```

### 2.4 Verify

Open `https://circleme-server.onrender.com/` in your browser. You should see:
```json
{ "status": "ok", "uptime": 12.345 }
```

---

## Step 3 — Deploy the Client on Vercel

### 3.1 Create the Project

1. Go to [vercel.com](https://vercel.com) and sign in
2. Click **"Add New…"** → **"Project"**
3. Import your GitHub repo (`CircleMe`)
4. Configure:

| Setting | Value |
|---------|-------|
| **Framework Preset** | Vite |
| **Root Directory** | `client` |
| **Build Command** | `npm run build` |
| **Output Directory** | `dist` |
| **Install Command** | `npm install` |

### 3.2 Add Environment Variables

In the Vercel project settings → **Environment Variables**:

| Key | Value |
|-----|-------|
| `VITE_SOCKET_URL` | `https://circleme-server.onrender.com` |

> [!CAUTION]
> The variable MUST start with `VITE_` for Vite to expose it to the client bundle. Without the prefix, it will be ignored.

### 3.3 Deploy

Click **"Deploy"**. Wait for the build to finish.

Your app URL will be something like:
```
https://circleme.vercel.app
```

---

## Step 4 — Update CORS on Server

Now that you have your Vercel URL, go back to **Render** and update the environment variable:

| Key | Value |
|-----|-------|
| `CLIENT_URL` | `https://circleme.vercel.app` |

> [!TIP]
> You can allow multiple origins by separating them with commas:
> `https://circleme.vercel.app,https://your-custom-domain.com`

Render will automatically redeploy when you save the variable.

---

## Step 5 — Verify Everything

1. Open your Vercel URL (e.g. `https://circleme.vercel.app`)
2. Enter your name and click "Join Location Room"
3. Allow location & media permissions
4. Open the same URL in another browser/tab to test multi-user

---

## ⚠️ Important Notes

### Render Free Tier Spin-Down

> [!WARNING]
> Render's free tier spins down services after 15 minutes of inactivity. The first connection after spin-down takes ~30-60 seconds. Upgrade to the **Starter** plan ($7/mo) for always-on.

### HTTPS Requirement

Both Vercel and Render serve over HTTPS by default. This is **required** for:
- `navigator.mediaDevices.getUserMedia()` (camera/mic)
- `navigator.geolocation.getCurrentPosition()` (GPS)

### Custom Domain (Optional)

- **Vercel**: Project Settings → Domains → Add your domain
- **Render**: Service Settings → Custom Domain → Add your domain
- Update `CLIENT_URL` on Render if you change the frontend domain

---

## 🔄 Updating the App

After pushing changes to GitHub:
- **Vercel** automatically rebuilds the client on every push to `main`
- **Render** automatically rebuilds the server on every push to `main`

No manual redeployment needed!

---

## 📋 Quick Reference

| Component | Platform | Root Dir | URL |
|-----------|----------|----------|-----|
| Frontend  | Vercel   | `client` | `https://your-app.vercel.app` |
| Backend   | Render   | `server` | `https://your-server.onrender.com` |

| Env Variable | Where | Value |
|-------------|-------|-------|
| `VITE_SOCKET_URL` | Vercel (client) | Your Render server URL |
| `CLIENT_URL` | Render (server) | Your Vercel app URL |
| `NODE_ENV` | Render (server) | `production` |
