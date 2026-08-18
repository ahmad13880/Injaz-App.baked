const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const app = express();
const PORT = process.env.PORT || 5000;
const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, '../../database/injaz.db');

// Ensure database directory exists
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// Connect to SQLite Database
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('❌ Database Connection Error:', err.message);
  } else {
    console.log(`🗄️ Connected to SQLite database at: ${DB_PATH}`);
    initDatabase();
  }
});

// Run DB Schema initialization and automatic column migrations
function initDatabase() {
  const schemaPath = path.join(__dirname, '../../database/schema.sql');
  if (fs.existsSync(schemaPath)) {
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');
    db.exec(schemaSql, (err) => {
      if (err) {
        console.error('❌ Schema initialization error:', err.message);
      } else {
        console.log('✅ SQLite Schema initialized successfully.');
      }
      
      // Auto-migrate any columns if db existed before
      migrateTableColumns();
    });
  }
}

function migrateTableColumns() {
  // Check users table columns
  db.all("PRAGMA table_info(users)", (err, rows) => {
    if (!err && rows) {
      const cols = rows.map(r => r.name);
      if (!cols.includes('password_hash')) {
        db.run("ALTER TABLE users ADD COLUMN password_hash TEXT");
      }
      if (!cols.includes('avatar')) {
        db.run("ALTER TABLE users ADD COLUMN avatar TEXT DEFAULT '⚡'");
      }
    }
  });

  // Check tasks table columns
  db.all("PRAGMA table_info(tasks)", (err, rows) => {
    if (!err && rows) {
      const cols = rows.map(r => r.name);
      if (!cols.includes('subtasks')) {
        db.run("ALTER TABLE tasks ADD COLUMN subtasks TEXT DEFAULT '[]'");
      }
    }
  });
}

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static levels JSON if accessed directly
app.use('/gamification', express.static(path.join(__dirname, '../../gamification')));

// Mount API Routes
const apiRoutes = require('./routes/api');
app.use('/api', apiRoutes(db));

// Root Health Check Route
app.get('/', (req, res) => {
  res.json({
    app: 'Injaz (إنجاز) API',
    status: 'Running',
    version: '1.2.0',
    documentation: '/api/levels'
  });
});

// Start Server
app.listen(PORT, () => {
  console.log(`🚀 Injaz Backend Server running on http://localhost:${PORT}`);
});
