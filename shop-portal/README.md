# Shop Portal (React)

Website for external printing shops. Talks to the same Django backend as the admin app, but only
through the `/api/shop/...` endpoints.

## Run

    npm install
    npm run dev          # http://localhost:5174  (Django must run on 127.0.0.1:8000)

`/api` is proxied to Django (see vite.config.js), so cookies and CSRF work without extra setup.

> Admin app (5173) and this app (5174) both run on `localhost`, and browsers share cookies between
> ports. Open one of them as `http://127.0.0.1:5173` and the other as `http://localhost:5174`,
> otherwise signing in here signs the admin out.

## Screens

| Route                                | Page          |
|--------------------------------------|---------------|
| `/login`                             | Shop sign-in  |
| `/setup-password/:uid/:token`        | Set password (target of the invitation link) |
| `/`                                  | Dashboard (placeholder, needs sign-in) |

## Backend endpoints this app expects (to be built next, in Django)

    GET  /api/auth/csrf/                          existing
    GET  /api/shop/me/                            -> {shop: {...} | null}
    POST /api/shop/auth/login/                    {username, password} -> {shop}
    POST /api/shop/auth/logout/
    GET  /api/shop/auth/setup-password/<uid>/<token>/   -> {valid, shop_name, username}
    POST /api/shop/auth/setup-password/           {uid, token, password, confirm_password}
