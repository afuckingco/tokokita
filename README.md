# TokoKita — Web Jualan ala Indomaret 🧺

> A small but security-hardened Node.js + Express online shop. Product catalog, shopping cart,
> checkout, admin dashboard — built as a portfolio piece to demonstrate end-to-end web security
> on a real (if minimal) application.

![Node](https://img.shields.io/badge/node-%3E%3D18-green)
![Express](https://img.shields.io/badge/express-5-blue)
![License](https://img.shields.io/badge/license-MIT-blue)
![Security](https://img.shields.io/badge/security-hardened-brightgreen)

---

## Features

**Customer:**
- Browse products by category
- Add to cart, update quantity, remove items
- Checkout with name / phone / address
- Stock auto-decrement on successful checkout

**Admin** (`/admin/login`, default `admin` / `admin123`):
- Session-based login
- Dashboard with product/order/revenue stats
- CRUD products (with image upload)
- CRUD categories
- View all orders + update status (`pending → diproses → dikirim → selesai → cancelled`)

**Visual polish:**
- Hero section with interactive 3D rotating shopping basket (Three.js)
- Product cards with 3D tilt effect on hover
- Olive-green palette with Fraunces + Inter typography

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Start server
npm start

# 3. Open browser
#    Customer shop:  http://localhost:3000
#    Admin login:    http://localhost:3000/admin/login
```

Default admin: `admin` / `admin123` — **change before deploying to a public server.**

---

## Stack

| Layer | Choice | Why |
|---|---|---|
| Runtime | Node.js ≥ 18 | Modern syntax, fetch, native test runner |
| Framework | Express 5 | Minimal, well-known |
| Templates | EJS | Server-rendered, auto-escapes by default |
| Database | sql.js (SQLite via WebAssembly) | Zero native compilation — runs anywhere |
| Sessions | express-session | Server-side, signed cookies |
| Password | bcryptjs | Pure-JS bcrypt (no native build) |
| Uploads | multer | De-facto multipart parser |

---

## 🔒 Security — What I Hardened

This started as a basic CRUD demo. I then ran a manual security audit and applied
the following fixes:

### 1. Security Headers (`helmet`)
- Content-Security-Policy restricting script/style sources (allows Three.js CDN)
- X-Frame-Options: SAMEORIGIN (anti-clickjacking)
- X-Content-Type-Options: nosniff
- Strict-Transport-Security (production only)
- Referrer-Policy: no-referrer

### 2. CSRF Protection (double-submit cookie pattern)
- Per-session token in `req.session.csrfToken`
- Validated on every non-multipart POST via `req.body._csrf`
- Helper partial `views/partials/csrf.ejs` auto-included in all 11 forms
- Token rotated on login (`req.session.regenerate`) to prevent fixation

### 3. Session Hardening
- Secret from `process.env.SESSION_SECRET` (random 48-byte hex fallback in dev)
- Cookie: `httpOnly`, `secure` (prod), `sameSite: 'lax'`, 4-hour expiry
- Custom cookie name (`toko.sid`, not default `connect.sid`)
- Session ID regenerated on login/logout

### 4. Rate Limiting (`express-rate-limit`)
- `/admin/login`: 5 attempts per 15 minutes per IP
- Returns `Retry-After` + `RateLimit-*` standard headers

### 5. File Upload Validation (`multer`)
- MIME type whitelist: `image/jpeg`, `image/png`, `image/webp`, `image/gif`
- Extension whitelist (defense in depth — MIME alone isn't enough)
- Filename via `crypto.randomUUID()` (no user-controlled paths)
- Size limit 2 MB
- This blocks the classic **stored XSS via uploaded `.html`/`.svg` payloads**

### 6. Open Redirect Fix
`/cart/add` originally redirected to `req.get('referer')` — letting attackers craft
links from `evil.com` to redirect victims after adding to cart. Now validates
that the referer host matches the request host.

### 7. Timing-Safe Password Comparison
Always calls `bcrypt.compareSync` (with a dummy hash if user not found) so the
response time doesn't reveal which usernames exist.

### 8. Atomic Stock Decrement
Race-condition fix: `UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?`
returns `rowsModified = 0` if stock ran out mid-checkout. Combined with a
transaction wrapper, this prevents overselling.

### 9. Input Length Validation
All text fields truncated server-side (name: 200 chars, phone: 30, address: 500,
category: 100, customer fields similar). Prevents DB bloat via 10 MB submissions.

### 10. Order Status Whitelist
`POST /admin/orders/:id/status` validates the new status against an enum
before updating — prevents arbitrary status string injection.

### 11. Global Error Handler
Production responses hide stack traces; dev mode shows them. 404 returns a
styled error page instead of leaking internals.

---

## Known Trade-offs

**Multipart CSRF:** CSRF check is skipped for `multipart/form-data` because
multer consumes the body stream and conflicts with body-parser-based token
validation. Compensating controls:
- `SameSite=Lax` cookie (browsers block cross-site POST)
- `requireAdmin` middleware on every admin upload route
- File type validation as the primary defense

For high-security deployments, send CSRF tokens via custom HTTP header
(`X-CSRF-Token`) instead of body field, set by the form's JS.

---

## Project Structure

```
toko-app/
├── server.js               # Express app + all routes + security middleware
├── package.json
├── db/
│   ├── database.js         # sql.js wrapper with transaction() + atomic decrement
│   └── toko.sqlite         # Created on first run (auto-seeded with sample data)
├── public/
│   ├── css/style.css       # Olive-green palette, Fraunces + Inter fonts
│   ├── js/
│   │   ├── hero-3d.js      # Three.js rotating shopping basket
│   │   └── tilt.js         # 3D tilt effect on product cards
│   └── uploads/            # Product images (gitignored)
└── views/
    ├── index.ejs, cart.ejs, checkout.ejs, order-success.ejs
    ├── error.ejs
    ├── partials/
    │   ├── header.ejs, footer.ejs
    │   └── csrf.ejs        # CSRF hidden input — include in every form
    └── admin/
        ├── login.ejs, dashboard.ejs, products.ejs, orders.ejs, order-detail.ejs
        └── _layout_top.ejs, _layout_bottom.ejs
```

---

## Production Checklist

Before deploying this to a public server, do these things:

1. **Set `SESSION_SECRET`** to a stable random value:
   ```bash
   export SESSION_SECRET=*** -e "console.log(require('crypto').randomBytes(48).toString('hex'))")
   ```
2. **Set `NODE_ENV=production`** to enable `secure` cookies + HSTS
3. **Change the default admin password** — edit `db/database.js` `seedAdmin()`
   or add a password-change UI
4. **Put behind HTTPS reverse proxy** (nginx / Caddy / Cloudflare) and set
   `TRUST_PROXY=1` so `req.ip` reflects the real client
5. **Consider migrating** from `sql.js` (in-memory + persisted) to
   `better-sqlite3` (native, proper file locking) for production traffic
6. **Add a payment integration** (Midtrans, Xendit, Stripe) for real checkout
7. **Add customer accounts** so order history is queryable per-customer

---

## Things I'd Improve With More Time

- Customer-facing order history + status tracking
- Email/SMS notifications on new orders
- Product search + filter by price
- Image variants (thumbnails, responsive srcset)
- Automated tests (`node:test` + supertest)
- GitHub Actions CI for lint + smoke test on push
- Docker Compose for one-line deploy

---

## Author

**Afiq Andico Pangimpian** — IT professional & tinkerer, Bali, Indonesia.

- GitHub: [@afiqandico13](https://github.com/afiqandico13)
- Contact: afiqandico13@gmail.com

Built as a portfolio project to demonstrate full-stack web security knowledge
on a concrete, runnable application rather than abstract examples.

## License

MIT — see [LICENSE](LICENSE).
