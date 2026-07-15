```console
┌──(test㉿afuckingco)-[~/projects/tokokita]
└─$ cat README.md
```

# 🧺 TokoKita — Security-Hardened E-Commerce

> A minimal but rigorously secured Node.js + Express online shop. Built as a portfolio piece to demonstrate end-to-end web security, secure coding practices, and defensive architecture on a real-world application.

<div align="center">

[![Status](https://img.shields.io/badge/STATUS-OPERATIONAL-a6e3a1?style=for-the-badge&labelColor=1e1e2e)]()
[![License](https://img.shields.io/badge/License-MIT-89b4fa?style=for-the-badge&labelColor=1e1e2e)](LICENSE)
[![Security](https://img.shields.io/badge/Security-Hardened-f9e2af?style=for-the-badge&labelColor=1e1e2e)]()

</div>

---

```console
┌──(test㉿afuckingco)-[~/projects/tokokita]
└─$ ls -la ./features
```

## 🛒 Core Features

| Module | Capabilities |
|--------|--------------|
| **Customer** | Browse by category, cart management, checkout with contact details, atomic stock decrement |
| **Admin** | Session-based auth, dashboard stats, CRUD products/categories (with secure image upload), order status workflow |
| **Visual** | Three.js 3D rotating hero basket, 3D tilt effect on product cards, Olive-green palette (Fraunces + Inter) |

---

```console
┌──(test㉿afuckingco)-[~/projects/tokokita]
└─$ htop --stack
```

## 🛠️ Technology Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| **Runtime** | ![Node.js](https://img.shields.io/badge/Node.js-339933?style=flat&logo=nodedotjs&logoColor=white) ≥ 18 | Modern syntax, native test runner, fetch API |
| **Framework** | ![Express](https://img.shields.io/badge/Express-000000?style=flat&logo=express&logoColor=white) 5 | Minimal, well-known, unopinionated |
| **Templates** | ![EJS](https://img.shields.io/badge/EJS-B4CA65?style=flat&logo=ejs&logoColor=white) | Server-rendered, auto-escapes by default |
| **Database** | ![SQLite](https://img.shields.io/badge/SQLite-003B57?style=flat&logo=sqlite&logoColor=white) (sql.js) | Zero native compilation, runs anywhere via WASM |
| **Sessions** | `express-session` | Server-side, signed cookies, custom naming |
| **Security** | ![Helmet](https://img.shields.io/badge/Helmet-583CE9?style=flat) + `bcryptjs` | Pure-JS bcrypt, robust header management |
| **Uploads** | `multer` | De-facto multipart parser with strict validation |

---

```console
┌──(test㉿afuckingco)-[~/projects/tokokita]
└─$ sudo nmap -sV --script vuln localhost
```

## 🔒 Security Hardening (The Core Focus)

This started as a basic CRUD demo. I then ran a manual security audit and applied the following defensive measures:

| # | Mitigation | Implementation Details |
|---|------------|------------------------|
| **1** | **Security Headers** | `helmet`: CSP (restricts script/style, allows Three.js CDN), X-Frame-Options: SAMEORIGIN, X-Content-Type-Options: nosniff, HSTS (prod), Referrer-Policy: no-referrer |
| **2** | **CSRF Protection** | Double-submit cookie pattern. Per-session token validated on all non-multipart POSTs. Token rotated on login to prevent fixation. |
| **3** | **Session Hardening** | `httpOnly`, `secure` (prod), `sameSite: 'lax'`, 4-hour expiry. Custom cookie name (`toko.sid`). ID regenerated on login/logout. |
| **4** | **Rate Limiting** | `express-rate-limit`: `/admin/login` capped at 5 attempts per 15 mins per IP. Returns `Retry-After` + `RateLimit-*` headers. |
| **5** | **File Upload Validation** | MIME + extension whitelist (`jpeg`, `png`, `webp`, `gif`). Filename via `crypto.randomUUID()`. 2 MB size limit. Blocks stored XSS via `.html`/`.svg`. |
| **6** | **Open Redirect Fix** | `/cart/add` referer validation now ensures the host matches the request host, preventing evil.com redirect chains. |
| **7** | **Timing-Safe Auth** | `bcrypt.compareSync` always called (with dummy hash if user not found) to prevent username enumeration via response time. |
| **8** | **Atomic Stock Decrement** | `UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?`. Prevents race-condition overselling mid-checkout. |
| **9** | **Input Length Validation** | Server-side truncation on all text fields (name: 200, phone: 30, address: 500). Prevents DB bloat via massive submissions. |
| **10**| **Status Whitelist** | `POST /admin/orders/:id/status` validates against a strict enum before updating, preventing arbitrary string injection. |
| **11**| **Global Error Handler** | Production responses hide stack traces. 404 returns a styled error page instead of leaking framework internals. |

---

```console
┌──(test㉿afuckingco)-[~/projects/tokokita]
└─$ ./start.sh
```

## 🚀 Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Start server
npm start

# 3. Open browser
#    Customer shop:  http://localhost:3000
#    Admin login:    http://localhost:3000/admin/login
```
> **⚠️ Default Admin:** `admin` / `admin123` — **Change immediately before any public deployment.**

---

```console
┌──(test㉿afuckingco)-[~/projects/tokokita]
└─$ tree -L 2 -I 'node_modules'
```

## 📂 Project Structure

```text
toko-app/
├── server.js               # Express app + routes + security middleware
├── package.json
├── db/
│   ├── database.js         # sql.js wrapper with transaction() + atomic decrement
│   └── toko.sqlite         # Auto-seeded with sample data on first run
├── public/
│   ├── css/style.css       # Olive-green palette, Fraunces + Inter fonts
│   ├── js/
│   │   ├── hero-3d.js      # Three.js rotating shopping basket
│   │   └── tilt.js         # 3D tilt effect on product cards
│   └── uploads/            # Product images (gitignored, validated)
└── views/
    ├── index.ejs, cart.ejs, checkout.ejs, order-success.ejs
    ├── error.ejs
    ├── partials/
    │   ├── header.ejs, footer.ejs
    │   └── csrf.ejs        # CSRF hidden input — included in every form
    └── admin/
        ├── login.ejs, dashboard.ejs, products.ejs, orders.ejs
        └── _layout_top.ejs, _layout_bottom.ejs
```

---

```console
┌──(test㉿afuckingco)-[~/projects/tokokita]
└─$ cat KNOWN_TRADEOFFS.md
```

## ⚠️ Known Trade-offs & Limitations

- **Multipart CSRF**: CSRF check is skipped for `multipart/form-data` because `multer` consumes the body stream, conflicting with body-parser-based token validation. 
  - *Compensating controls*: `SameSite=Lax` cookie, `requireAdmin` middleware on all upload routes, and strict file-type validation as the primary defense.
  - *High-security fix*: Send CSRF tokens via custom HTTP header (`X-CSRF-Token`) set by the form's JS, rather than the body field.

---

```console
┌──(test㉿afuckingco)-[~/projects/tokokita]
└─$ echo $FUTURE_IMPROVEMENTS
```

## 📈 Future Improvements

- [ ] Customer-facing order history & status tracking
- [ ] Email/SMS notifications on new orders
- [ ] Product search & advanced filtering (price, category)
- [ ] Automated test suite (`node:test` + `supertest`)
- [ ] GitHub Actions CI for linting + smoke testing on push
- [ ] Docker Compose setup for one-line deployment
- [ ] Migration from `sql.js` to `better-sqlite3` for proper file locking in high-traffic production

---

```console
┌──(test㉿afuckingco)-[~/projects/tokokita]
└─$ connect --author
```

## 👤 Author

**Afiq Andico Pangimpian** — IT professional, security researcher & tinkerer, Bali, Indonesia.

<div align="center">
  <a href="https://github.com/afuckingco" target="_blank">
    <img src="https://img.shields.io/badge/GitHub-181717?style=for-the-badge&logo=github&logoColor=white"/>
  </a>
  <a href="https://www.linkedin.com/in/pangimpian" target="_blank">
    <img src="https://img.shields.io/badge/LinkedIn-0077B5?style=for-the-badge&logo=linkedin&logoColor=white"/>
  </a>
  <a href="mailto:afiqandico13@gmail.com" target="_blank">
    <img src="https://img.shields.io/badge/Email-D14836?style=for-the-badge&logo=gmail&logoColor=white"/>
  </a>
</div>

> *Built as a portfolio project to demonstrate full-stack web security knowledge on a concrete, runnable application rather than abstract examples.*

```console
┌──(test㉿afuckingco)-[~/projects/tokokita]
└─$ exit
```
> *Connection closed. Build something secure.*
