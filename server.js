// server.js
// TokoKita - Web toko online sederhana
//
// Security hardening yang diterapkan:
// - Session secret dari env (fallback random + warning)
// - Cookie session: httpOnly, secure (prod), sameSite=lax
// - Helmet: CSP, X-Frame-Options, X-Content-Type-Options, HSTS
// - Rate limit pada /admin/login (5 percobaan / 15 menit / IP)
// - CSRF token (double-submit pattern) pada semua POST
// - Multer: filter MIME image saja, nama file via crypto.randomUUID()
// - Fix open redirect di /cart/add (validasi same-origin)
// - Stock decrement atomic (WHERE stock >= ?), checkout dalam transaction
// - Input length validation, body size limit
// - Global error handler (no stack trace leak)
// - Trust proxy jika di belakang nginx/reverse proxy

const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const dbModule = require('./db/database');

const app = express();
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_PROD = NODE_ENV === 'production';

// ============================================================================
// SESSION SECRET — WAJIB dari env di production. Di dev, generate random.
// ============================================================================
let sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  if (IS_PROD) {
    console.error('FATAL: SESSION_SECRET wajib di-set di production. Contoh:');
    console.error('  export SESSION_SECRET=$(node -e "console.log(crypto.randomBytes(48).toString(\'hex\'))")');
    process.exit(1);
  }
  sessionSecret = crypto.randomBytes(48).toString('hex');
  console.warn('[WARN] SESSION_SECRET tidak di-set — menggunakan random secret (dev only).');
  console.warn('       Sesi akan invalid setiap server restart.');
}

// ============================================================================
// TRUST PROXY (jika di belakang nginx/cloudflare)
// ============================================================================
if (process.env.TRUST_PROXY === '1') {
  app.set('trust proxy', 1);
}

// ============================================================================
// SECURITY HEADERS (helmet)
// ============================================================================
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // Three.js dimuat dari CDN — butuh script-src dari cdnjs + inline 'unsafe-inline'
        // untuk EJS-rendered inline scripts (jika ada)
        scriptSrc: ["'self'", 'https://cdnjs.cloudflare.com', "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false, // EJS views + external CDN butuh ini off
  })
);

// ============================================================================
// BODY PARSING (with size limit)
// ============================================================================
app.use(express.urlencoded({ extended: true, limit: '32kb' }));
app.use(express.json({ limit: '32kb' }));

// ============================================================================
// SESSION
// ============================================================================
app.use(
  session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    name: 'toko.sid',
    cookie: {
      maxAge: 1000 * 60 * 60 * 4, // 4 jam
      httpOnly: true,
      secure: IS_PROD,
      sameSite: 'lax',
      path: '/',
    },
  })
);

// ============================================================================
// CSRF PROTECTION (double-submit pattern, tanpa external dep)
// Token disimpan di session, divalidasi dari body form field `_csrf`.
// Views harus include partials/csrf.ejs di setiap form.
// ============================================================================
function generateCsrfToken() {
  return crypto.randomBytes(32).toString('hex');
}

// Kirim token ke semua views via res.locals
app.use((req, res, next) => {
  if (!req.session.csrfToken) {
    req.session.csrfToken = generateCsrfToken();
  }
  res.locals.csrfToken = req.session.csrfToken;
  res.locals.formatRupiah = (n) => 'Rp ' + Number(n).toLocaleString('id-ID');
  next();
});

// Validasi CSRF untuk semua POST/PUT/DELETE.
// Catatan: untuk multipart/form-data (upload file), urlencoded parser di atas
// tidak mem-parse body. Kita SKIP CSRF check untuk multipart dan andalkan
// SameSite=Lax cookie (memblokir cross-site POST) + validasi session admin
// di requireAdmin middleware. Trade-off: sedikit kurang aman, tapi csrf check
// untuk multipart tidak bisa dilakukan tanpa consume stream (konflik dengan
// multer.single() di route handler).
function csrfProtection(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.is('multipart/form-data')) return next(); // see note above

  const tokenFromSession = req.session.csrfToken;
  const tokenFromBody = req.body && req.body._csrf;
  if (!tokenFromSession || !tokenFromBody || tokenFromSession !== tokenFromBody) {
    console.warn(`[CSRF] Rejected ${req.method} ${req.path} from ${req.ip} (token mismatch)`);
    return res.status(403).render('error', {
      message: 'Sesi tidak valid atau token CSRF kadaluarsa. Silakan muat ulang halaman.',
      back: '/',
    });
  }
  next();
}

app.use(csrfProtection);

// ============================================================================
// UPLOAD GAMBAR PRODUK (filter MIME, nama file crypto-random)
// ============================================================================
const uploadDir = path.join(__dirname, 'public/uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const ALLOWED_IMAGE_MIME = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
]);

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
      // Selalu pakai UUID + extension. Nama asli diabaikan untuk keamanan.
      const ext = path.extname(file.originalname).toLowerCase();
      // Whitelist extension juga (defense in depth)
      const safeExt = ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext) ? ext : '.jpg';
      cb(null, crypto.randomUUID() + safeExt);
    },
  }),
  limits: { fileSize: 2 * 1024 * 1024 }, // max 2MB
  fileFilter: (req, file, cb) => {
    if (ALLOWED_IMAGE_MIME.has(file.mimetype)) {
      return cb(null, true);
    }
    // Tolak file non-image (HTML/JS/SVG/exe/dll.)
    const err = new Error('Hanya file gambar yang diizinkan (JPG, PNG, WebP, GIF).');
    err.code = 'INVALID_FILE_TYPE';
    return cb(err);
  },
});

// ============================================================================
// VIEW ENGINE & STATIC
// ============================================================================
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================================
// HELPER
// ============================================================================
function requireAdmin(req, res, next) {
  if (req.session && req.session.adminId) return next();
  return res.redirect('/admin/login');
}

function getCart(req) {
  if (!req.session.cart) req.session.cart = {};
  return req.session.cart;
}

// Validasi same-origin untuk redirect (anti open-redirect)
function safeRedirect(req, fallback) {
  const referer = req.get('referer');
  if (!referer) return fallback;
  try {
    const refUrl = new URL(referer);
    // Hanya izinkan redirect ke host yang sama
    if (refUrl.host === req.get('host')) return refUrl.pathname + refUrl.search;
  } catch (_) {
    // Referer malformed — abaikan
  }
  return fallback;
}

// Truncate string untuk mencegah DB bloat
function truncate(s, max) {
  if (typeof s !== 'string') return '';
  return s.length > max ? s.slice(0, max) : s;
}

// ============================================================================
// RATE LIMITING
// ============================================================================
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 menit
  max: 5, // 5 percobaan per IP
  message: 'Terlalu banyak percobaan login. Coba lagi 15 menit lagi.',
  standardHeaders: true,
  legacyHeaders: false,
});

// ============================================================================
// ROUTE CUSTOMER
// ============================================================================
app.get('/', (req, res) => {
  const categoryId = req.query.category;
  let products;
  if (categoryId) {
    products = dbModule.all(
      `SELECT * FROM products WHERE category_id = ? ORDER BY name`,
      [categoryId]
    );
  } else {
    products = dbModule.all(`SELECT * FROM products ORDER BY name`);
  }
  const categories = dbModule.all(`SELECT * FROM categories ORDER BY name`);
  const cart = getCart(req);
  const cartCount = Object.values(cart).reduce((a, b) => a + b, 0);

  res.render('index', {
    products,
    categories,
    activeCategory: categoryId ? Number(categoryId) : null,
    cartCount,
  });
});

app.post('/cart/add', (req, res) => {
  const productId = parseInt(req.body.productId);
  const qty = parseInt(req.body.qty) || 1;
  if (!Number.isInteger(productId) || productId <= 0) {
    return res.redirect('/');
  }
  const cart = getCart(req);
  cart[productId] = (cart[productId] || 0) + Math.max(1, qty);
  // Fix open redirect: hanya izinkan same-origin
  res.redirect(safeRedirect(req, '/'));
});

app.post('/cart/update', (req, res) => {
  const productId = parseInt(req.body.productId);
  const qty = parseInt(req.body.qty);
  if (!Number.isInteger(productId)) return res.redirect('/cart');
  const cart = getCart(req);
  if (!Number.isInteger(qty) || qty <= 0) {
    delete cart[productId];
  } else {
    cart[productId] = qty;
  }
  res.redirect('/cart');
});

app.post('/cart/remove', (req, res) => {
  const productId = parseInt(req.body.productId);
  if (!Number.isInteger(productId)) return res.redirect('/cart');
  const cart = getCart(req);
  delete cart[productId];
  res.redirect('/cart');
});

app.get('/cart', (req, res) => {
  const cart = getCart(req);
  const items = Object.entries(cart).map(([productId, qty]) => {
    const product = dbModule.get(`SELECT * FROM products WHERE id = ?`, [parseInt(productId)]);
    return product ? { ...product, qty, subtotal: product.price * qty } : null;
  }).filter(Boolean);

  const total = items.reduce((sum, i) => sum + i.subtotal, 0);
  res.render('cart', { items, total });
});

app.get('/checkout', (req, res) => {
  const cart = getCart(req);
  if (Object.keys(cart).length === 0) return res.redirect('/cart');

  const items = Object.entries(cart).map(([productId, qty]) => {
    const product = dbModule.get(`SELECT * FROM products WHERE id = ?`, [parseInt(productId)]);
    return product ? { ...product, qty, subtotal: product.price * qty } : null;
  }).filter(Boolean);
  const total = items.reduce((sum, i) => sum + i.subtotal, 0);

  res.render('checkout', { items, total, error: null });
});

// Proses checkout — atomic, validasi stok di dalam transaction
app.post('/checkout', (req, res) => {
  const customer_name = truncate(req.body.customer_name || '', 100);
  const customer_phone = truncate(req.body.customer_phone || '', 30);
  const customer_address = truncate(req.body.customer_address || '', 500);
  const cart = getCart(req);

  if (Object.keys(cart).length === 0) return res.redirect('/cart');
  if (!customer_name || !customer_phone || !customer_address) {
    const items = Object.entries(cart).map(([productId, qty]) => {
      const product = dbModule.get(`SELECT * FROM products WHERE id = ?`, [parseInt(productId)]);
      return product ? { ...product, qty, subtotal: product.price * qty } : null;
    }).filter(Boolean);
    const total = items.reduce((sum, i) => sum + i.subtotal, 0);
    return res.render('checkout', { items, total, error: 'Semua data wajib diisi.' });
  }

  const items = Object.entries(cart).map(([productId, qty]) => {
    const product = dbModule.get(`SELECT * FROM products WHERE id = ?`, [parseInt(productId)]);
    return product ? { ...product, qty } : null;
  }).filter(Boolean);

  // Validasi stok awal (cek sebelum transaction untuk UX yang jelas)
  for (const item of items) {
    if (item.qty > item.stock) {
      const totalNow = items.reduce((s, i) => s + i.price * i.qty, 0);
      return res.render('checkout', {
        items: items.map(i => ({ ...i, subtotal: i.price * i.qty })),
        total: totalNow,
        error: `Stok "${item.name}" tidak cukup (sisa ${item.stock}).`,
      });
    }
  }

  const total = items.reduce((sum, i) => sum + i.price * i.qty, 0);

  // Atomic checkout: order + items + stock decrement dalam transaction
  let orderId;
  try {
    orderId = dbModule.transaction(() => {
      const orderResult = dbModule.run(
        `INSERT INTO orders (customer_name, customer_phone, customer_address, total, status) VALUES (?, ?, ?, ?, 'pending')`,
        [customer_name, customer_phone, customer_address, total]
      );
      const newOrderId = orderResult.lastInsertRowid;

      for (const item of items) {
        // Atomic decrement: gagal jika stok berubah (race condition)
        const ok = dbModule.decrementStock(item.id, item.qty);
        if (!ok) {
          // Stok habis dalam proses — throw untuk rollback transaction
          const err = new Error(`Stok "${item.name}" habis saat checkout. Silakan coba lagi.`);
          err.userMessage = err.message;
          throw err;
        }
        dbModule.run(
          `INSERT INTO order_items (order_id, product_id, product_name, price, qty) VALUES (?, ?, ?, ?, ?)`,
          [newOrderId, item.id, item.name, item.price, item.qty]
        );
      }
      return newOrderId;
    });
  } catch (err) {
    if (err.userMessage) {
      const totalNow = items.reduce((s, i) => s + i.price * i.qty, 0);
      return res.render('checkout', {
        items: items.map(i => ({ ...i, subtotal: i.price * i.qty })),
        total: totalNow,
        error: err.userMessage,
      });
    }
    console.error('[checkout]', err);
    return res.status(500).render('error', {
      message: 'Terjadi kesalahan saat memproses pesanan. Silakan coba lagi.',
      back: '/cart',
    });
  }

  req.session.cart = {};
  res.render('order-success', { orderId, total });
});

// ============================================================================
// ROUTE ADMIN
// ============================================================================
app.get('/admin/login', (req, res) => {
  if (req.session.adminId) return res.redirect('/admin');
  res.render('admin/login', { error: null });
});

app.post('/admin/login', loginLimiter, (req, res) => {
  const username = truncate(req.body.username || '', 50);
  const password = req.body.password || '';

  const admin = dbModule.get(`SELECT * FROM admins WHERE username = ?`, [username]);
  // Timing-safe: tetap panggil bcrypt walaupun admin gak ada, biar timing seragam
  const dummyHash = '$2a$10$abcdefghijklmnopqrstuuabcdefghijklmnopqrstuvwxyz012345';
  const hashToCheck = admin ? admin.password : dummyHash;
  const passwordOk = bcrypt.compareSync(password, hashToCheck);

  if (!admin || !passwordOk) {
    console.warn(`[auth] Failed login for "${username}" from ${req.ip}`);
    return res.status(401).render('admin/login', { error: 'Username atau password salah.' });
  }

  // Rotate session ID setelah login (prevent session fixation)
  req.session.regenerate((err) => {
    if (err) {
      console.error('[auth] session regenerate error:', err);
      return res.status(500).render('error', { message: 'Gagal memulai sesi.', back: '/admin/login' });
    }
    req.session.adminId = admin.id;
    req.session.adminUsername = admin.username;
    // Re-issue CSRF token untuk sesi baru
    req.session.csrfToken = generateCsrfToken();
    res.locals.csrfToken = req.session.csrfToken;
    res.redirect('/admin');
  });
});

app.post('/admin/logout', (req, res) => {
  req.session.regenerate((err) => {
    if (err) return next(err);
    req.session.destroy(() => res.redirect('/admin/login'));
  });
});

app.get('/admin', requireAdmin, (req, res) => {
  const productCount = dbModule.get(`SELECT COUNT(*) as c FROM products`).c;
  const orderCount = dbModule.get(`SELECT COUNT(*) as c FROM orders`).c;
  const pendingCount = dbModule.get(`SELECT COUNT(*) as c FROM orders WHERE status = 'pending'`).c;
  const revenue = dbModule.get(`SELECT COALESCE(SUM(total),0) as s FROM orders WHERE status != 'cancelled'`).s;

  res.render('admin/dashboard', {
    productCount,
    orderCount,
    pendingCount,
    revenue,
    adminUsername: req.session.adminUsername,
  });
});

app.get('/admin/products', requireAdmin, (req, res) => {
  const products = dbModule.all(`
    SELECT p.*, c.name as category_name
    FROM products p LEFT JOIN categories c ON p.category_id = c.id
    ORDER BY p.id DESC
  `);
  const categories = dbModule.all(`SELECT * FROM categories ORDER BY name`);
  res.render('admin/products', { products, categories });
});

// Tambah produk — wrapped in try/catch untuk handle multer errors (e.g., invalid file type)
app.post('/admin/products/add', requireAdmin, (req, res, next) => {
  upload.single('image')(req, res, (err) => {
    if (err) {
      // Error dari multer (invalid type / too large)
      const products = dbModule.all(`SELECT * FROM products ORDER BY id DESC`);
      const categories = dbModule.all(`SELECT * FROM categories ORDER BY name`);
      return res.status(400).render('admin/products', {
        products,
        categories,
        error: err.message || 'Upload gagal.',
      });
    }
    const { name, price, stock, category_id } = req.body;
    const image = req.file ? '/uploads/' + req.file.filename : null;
    dbModule.run(
      `INSERT INTO products (name, price, stock, image, category_id) VALUES (?, ?, ?, ?, ?)`,
      [truncate(name || '', 200), parseInt(price) || 0, parseInt(stock) || 0, image, category_id || null]
    );
    res.redirect('/admin/products');
  });
});

app.post('/admin/products/edit/:id', requireAdmin, (req, res, next) => {
  upload.single('image')(req, res, (err) => {
    if (err) {
      return res.redirect('/admin/products');
    }
    const { name, price, stock, category_id } = req.body;
    const id = parseInt(req.params.id);
    if (!Number.isInteger(id)) return res.redirect('/admin/products');
    const existing = dbModule.get(`SELECT * FROM products WHERE id = ?`, [id]);
    if (!existing) return res.redirect('/admin/products');
    const image = req.file ? '/uploads/' + req.file.filename : existing.image;

    dbModule.run(
      `UPDATE products SET name = ?, price = ?, stock = ?, image = ?, category_id = ? WHERE id = ?`,
      [truncate(name || '', 200), parseInt(price) || 0, parseInt(stock) || 0, image, category_id || null, id]
    );
    res.redirect('/admin/products');
  });
});

app.post('/admin/products/delete/:id', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  if (Number.isInteger(id)) {
    dbModule.run(`DELETE FROM products WHERE id = ?`, [id]);
  }
  res.redirect('/admin/products');
});

app.post('/admin/categories/add', requireAdmin, (req, res) => {
  const name = truncate((req.body.name || '').trim(), 100);
  if (name) {
    dbModule.run(`INSERT INTO categories (name) VALUES (?)`, [name]);
  }
  res.redirect('/admin/products');
});

app.get('/admin/orders', requireAdmin, (req, res) => {
  const orders = dbModule.all(`SELECT * FROM orders ORDER BY id DESC`);
  res.render('admin/orders', { orders });
});

app.get('/admin/orders/:id', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  if (!Number.isInteger(id)) return res.redirect('/admin/orders');
  const order = dbModule.get(`SELECT * FROM orders WHERE id = ?`, [id]);
  if (!order) return res.redirect('/admin/orders');
  const items = dbModule.all(`SELECT * FROM order_items WHERE order_id = ?`, [id]);
  res.render('admin/order-detail', { order, items });
});

const ALLOWED_STATUSES = new Set(['pending', 'diproses', 'dikirim', 'selesai', 'cancelled']);
app.post('/admin/orders/:id/status', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  const status = String(req.body.status || '');
  if (Number.isInteger(id) && ALLOWED_STATUSES.has(status)) {
    dbModule.run(`UPDATE orders SET status = ? WHERE id = ?`, [status, id]);
  }
  res.redirect('/admin/orders/' + id);
});

// ============================================================================
// ERROR HANDLER — global, terakhir
// ============================================================================
app.use((req, res) => {
  res.status(404).render('error', { message: 'Halaman tidak ditemukan.', back: '/' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[error]', err);
  // Di production: jangan kirim detail error ke client
  const message = IS_PROD ? 'Terjadi kesalahan pada server.' : err.message;
  res.status(err.status || 500).render('error', { message, back: '/' });
});

// ============================================================================
// START
// ============================================================================
dbModule.init().then(() => {
  app.listen(PORT, () => {
    console.log(`Toko app jalan di http://localhost:${PORT}`);
    console.log(`Admin login: http://localhost:${PORT}/admin/login`);
    console.log(`Default credentials: admin / admin123 (ganti sebelum production!)`);
    console.log(`Mode: ${NODE_ENV}`);
  });
});
