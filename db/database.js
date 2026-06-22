// db/database.js
// Wrapper sederhana di atas sql.js supaya dipakai mirip seperti better-sqlite3,
// dan otomatis menyimpan perubahan ke file db/toko.sqlite di disk.
//
// Keamanan:
// - Semua query pakai parameterized (?) untuk mencegah SQL injection
// - Transaction() untuk operasi multi-step (BEGIN/COMMIT/ROLLBACK)
// - decrementStock() atomic: gagal jika stok kurang (cek rows modified)

const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const DB_FILE = path.join(__dirname, 'toko.sqlite');

let SQL = null;
let db = null;

// Simpan database ke file setiap ada perubahan (insert/update/delete)
function persist() {
  const data = db.export();
  fs.writeFileSync(DB_FILE, Buffer.from(data));
}

// Jalankan callback di dalam transaction. Auto-rollback jika callback throw.
// Catatan: sql.js single-threaded JS — transaction ini hanya berguna untuk
// konsistensi data (atomicity), bukan untuk concurrency.
function transaction(fn) {
  db.run('BEGIN');
  try {
    const result = fn();
    db.run('COMMIT');
    persist();
    return result;
  } catch (err) {
    try { db.run('ROLLBACK'); } catch (_) { /* ignore */ }
    throw err;
  }
}

async function init() {
  SQL = await initSqlJs();

  if (fs.existsSync(DB_FILE)) {
    const fileBuffer = fs.readFileSync(DB_FILE);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
    createSchema();
    seedAdmin();
    persist();
  }

  return db;
}

function createSchema() {
  db.run(`
    CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      price INTEGER NOT NULL,
      stock INTEGER NOT NULL DEFAULT 0,
      image TEXT,
      category_id INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (category_id) REFERENCES categories(id)
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_name TEXT NOT NULL,
      customer_phone TEXT,
      customer_address TEXT,
      total INTEGER NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      product_name TEXT NOT NULL,
      price INTEGER NOT NULL,
      qty INTEGER NOT NULL,
      FOREIGN KEY (order_id) REFERENCES orders(id),
      FOREIGN KEY (product_id) REFERENCES products(id)
    );
  `);
}

function seedAdmin() {
  const hash = bcrypt.hashSync('admin123', 10);
  db.run(`INSERT INTO admins (username, password) VALUES (?, ?)`, ['admin', hash]);

  // Beberapa kategori & produk contoh
  const categories = ['Sembako', 'Minuman', 'Snack', 'Kebersihan'];
  categories.forEach((c) => db.run(`INSERT INTO categories (name) VALUES (?)`, [c]));

  const products = [
    ['Beras 5kg', 65000, 50, 1],
    ['Minyak Goreng 2L', 32000, 40, 1],
    ['Gula Pasir 1kg', 15000, 60, 1],
    ['Aqua Botol 600ml', 4000, 100, 2],
    ['Teh Botol Sosro', 5000, 80, 2],
    ['Indomie Goreng', 3000, 200, 3],
    ['Chitato 68g', 12000, 30, 3],
    ['Sabun Mandi Lifebuoy', 6000, 70, 4],
    ['Sikat Gigi', 8000, 40, 4],
  ];
  products.forEach((p) =>
    db.run(
      `INSERT INTO products (name, price, stock, category_id) VALUES (?, ?, ?, ?)`,
      p
    )
  );
}

// Helper query: ambil banyak baris sebagai array of object
function all(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

// Helper query: ambil satu baris
function get(sql, params = []) {
  const rows = all(sql, params);
  return rows[0] || null;
}

// Helper run: insert/update/delete. Untuk UPDATE/DELETE, rowsModified berisi
// jumlah baris yang berubah (berguna untuk cek apakah kondisi terpenuhi).
function run(sql, params = []) {
  db.run(sql, params);
  const rowsModified = db.getRowsModified();
  const lastId = get('SELECT last_insert_rowid() as id')?.id;
  persist();
  return { lastInsertRowid: lastId, rowsModified };
}

// Decrement stok secara atomic: hanya update jika stok cukup.
// Return true jika berhasil, false jika stok kurang.
function decrementStock(productId, qty) {
  if (qty <= 0) return false;
  const result = run(
    `UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?`,
    [qty, productId, qty]
  );
  return result.rowsModified > 0;
}

module.exports = { init, all, get, run, transaction, decrementStock };
