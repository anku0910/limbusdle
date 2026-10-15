# 部署指南（Limbusdle）

本專案前端是純靜態的 Vite/React SPA（hash 路由 `#/`、`base: './'`、資料由 `dist/data/*.json` 讀取），
不需要任何後端，適合靜態託管 + CDN。

> 注意：`#/edit` 資料編輯器的儲存功能依賴 `PUT /api/db/*`，該 API 只在 `npm run dev`
> 期間存在（見 `frontend/vite-plugin-db.ts`）。正式站是唯讀的，按「儲存」會顯示錯誤。

## 建置

```powershell
cd frontend
npm ci
npm run build   # 產物在 frontend/dist
```

`vite build` 會把 `data/` 複製到 `dist/data/`，`thumbs/`、`background.webp` 等來自 `public/`。
部署時整個 `dist/` 一起上傳即可。

## 方式一：Cloudflare Pages（推薦）

免費、全球 CDN、原生 HTTPS，綁自訂網域最簡單。

### 1. 推上 GitHub

```powershell
git init
git add -A
git commit -m "init"
git remote add origin <你的 GitHub repo>
git push -u origin main
```

### 2. 用 Git 整合自動部署

1. Cloudflare Dashboard → Workers & Pages → Create → Pages → Connect to Git，選擇該 repo。
2. 建置設定：
   - Root directory：`frontend`
   - Build command：`npm run build`
   - Output directory：`dist`
3. 完成後得到 `xxx.pages.dev`，再到 Custom domains 綁自己的網域。

或使用已附的 GitHub Actions（`.github/workflows/deploy.yml`）：

- 在 repo 的 Settings → Secrets and variables → Actions 新增：
  - `CLOUDFLARE_API_TOKEN`
  - `CLOUDFLARE_ACCOUNT_ID`
- 推到 `main` 即會自動 build 並部署（`cloudflare/wrangler-action`）。

### 3. 直接用 wrangler 上傳（不經 GitHub）

```powershell
cd frontend
npx wrangler pages deploy dist --project-name=limbusdle
```

`frontend/wrangler.toml` 已設定 `pages_build_output_dir = "./dist"`。

### 4. 自訂網域 / DNS

- 子網域（如 `game.example.com`）：設 CNAME 指向 Pages。
- 根網域：用 Cloudflare 代理，依畫面指示設定。
- TLS 由 Cloudflare 自動簽發。

## 方式二：自己的 VPS（nginx）

```nginx
server {
  listen 443 ssl;
  server_name game.example.com;
  root /var/www/limbusdle/dist;
  location / { try_files $uri /index.html; }
}
```

HTTPS 可用 Caddy 或 Let's Encrypt 自動簽憑證。

## 臨時公開網址（免帳號，供預覽）

用 Cloudflare Quick Tunnel 把本機 preview 映射出去：

```powershell
cd frontend
npm run build
npm run preview -- --port 4174        # 另開一個終端
cloudflared tunnel --url http://localhost:4174
```

`vite.config.ts` 已設 `preview.allowedHosts = ['.trycloudflare.com']`，
否則 Vite 會以 `Blocked request` (403) 拒絕 tunnel 的網域。

Quick Tunnel 無 uptime 保證，關閉程序即失效，重開會換新網址，僅適合預覽。

## 驗證

```powershell
cd frontend
npm run typecheck
npm test                 # tsx --test src/lib/*.test.ts
npm run build
node e2e-check.mjs       # 需先啟動 preview server（localhost:4174）
```