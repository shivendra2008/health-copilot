# Deploying the backend on your own VM

FastAPI + PaddleOCR run in Docker on the VM. A **Cloudflare Tunnel** gives it a public HTTPS address without opening any ports.
Updating = push to GitHub, then run `./deploy.sh` on the VM.

```
Browser (Vercel, https) ──▶ https://api.yourdomain.com ──▶ Cloudflare ──▶ tunnel ──▶ VM: api container :8000
```

## 1. One-time VM setup (Ubuntu/Debian)

```bash
# Docker + compose plugin
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER && newgrp docker
docker compose version

# Get the code
git clone https://github.com/shivendra2008/health-copilot.git
cd health-copilot
```

## 2. Backend secrets (on the VM only)

```bash
cp backend/.env.example backend/.env
nano backend/.env
```
Fill in `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `GROQ_API_KEY`, and set
`CORS_ORIGINS=https://<your-vercel-app>.vercel.app` (comma-separate extra origins; keep `http://localhost:3000` if you also test locally).

## 3. Cloudflare Tunnel

### A. Permanent URL (needs a domain managed by Cloudflare)
1. Cloudflare dashboard → **Zero Trust → Networks → Tunnels → Create a tunnel → Cloudflared**. Name it `health-copilot`.
2. Copy the **tunnel token** (the long string after `--token` in the install command).
3. On the VM: `echo "TUNNEL_TOKEN=<paste token>" > .env`
4. In the tunnel's **Public Hostname** tab, add: hostname `api.yourdomain.com` → service **HTTP** → URL `api:8000`.
5. Deploy: `./deploy.sh`

Your API is now at `https://api.yourdomain.com` (check `/api/v1/health`).

### B. No domain: free quick tunnel (no Cloudflare account needed)
`./deploy.sh quick` starts a tunnel and prints a `https://<random-words>.trycloudflare.com` address.

- The address stays the same while the tunnel container keeps running. Normal updates (`./deploy.sh quick`) rebuild only the API and leave the tunnel alone.
- It **changes** if the tunnel container restarts: VM reboot, `docker compose restart`, Docker restart, or a crash.
  When that happens: get the new address with
  `docker compose logs quick-tunnel | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' | tail -1`,
  set it as `NEXT_PUBLIC_API_URL` in Vercel, and redeploy the frontend.
- Cloudflare gives no uptime guarantee for quick tunnels. Fine for demos; use option A for anything lasting.

## 4. Connect the frontend
- Vercel → project → Settings → Environment Variables → `NEXT_PUBLIC_API_URL = https://api.yourdomain.com` → **Redeploy**.
- Supabase → Authentication → URL Configuration → set **Site URL** and add your Vercel URL to **Redirect URLs**.

## 5. Updating after changes
```bash
cd health-copilot && ./deploy.sh          # or ./deploy.sh quick
```
Frontend changes go live automatically through Vercel when you push to `main`.

## Operations
```bash
docker compose ps                         # status
docker compose logs -f api                # API logs (no document text or keys are logged)
docker compose --profile tunnel restart   # restart
curl -s http://127.0.0.1:8000/api/v1/health
```
The first OCR request after a rebuild is slower while the models warm up (they are baked into the image).
The API is bound to `127.0.0.1` on the VM and reachable publicly only through the tunnel.
