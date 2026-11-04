# Limbusdle

Limbus Company Wordle 玩法的繁體中文鏡像站。

## 專案概述

- **前端**：Vite + React + Tailwind CSS，純靜態 SPA，無後端
- **資料**：Python 爬蟲從 Limbusdeck 與灰機百科抓取，產出中文化資料 JSON
- **部署**：Cloudflare Pages（推薦）或自有 nginx

## 快速開始

### 本地開發

```powershell
cd frontend
npm install
npm run dev
```

開啟 http://localhost:5173/

### 建置

```powershell
cd frontend
npm run build
```

產物位於 `frontend/dist/`。

### 檢查

```powershell
npm run typecheck   # tsc --noEmit
npm test            # tsx --test src/lib/*.test.ts
npm run build
```

## 資料來源

| 資料夾 | 說明 |
|--------|------|
| `data/` | 最終供前端使用的 JSON（`zh_identities.json`、`en_identities.json`、`i18n_dict.json`、`game_meta.json`） |
| `scripts/` | Python 爬蟲與資料抽出腳本 |
| `IDENTITIES.md` | 角色對照表（中文名、罪人、Wiki 頁面） |

## 部署

### Cloudflare Pages（推薦）

1. 推到 GitHub
2. Cloudflare Dashboard → Workers & Pages → Pages → Connect to Git
3. 設定：
   - Root directory：`frontend`
   - Build command：`npm run build`
   - Output directory：`dist`

或使用 `wrangler`：

```powershell
cd frontend
npx wrangler pages deploy dist --project-name=limbusdle
```

### 自有 VPS（nginx）

```nginx
server {
  listen 443 ssl;
  server_name game.example.com;
  root /var/www/limbusdle/dist;
  location / { try_files $uri /index.html; }
}
```

更多細節請見 `DEPLOY.md`。

## 授權

本專案為個人學習與鏡像用途，遊戲資料版權歸 Project Moon 與相關權利人所有。
