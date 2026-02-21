// ========================================
// NITKnot — Database Wrapper (SQLite / PostgreSQL)
// ========================================
// Uses PostgreSQL when DATABASE_URL is set (production on Render)
// Falls back to SQLite for local development

const path = require('path');

const isPostgres = !!process.env.DATABASE_URL;

console.log('--- DEBUG ENVIRONMENT ---');
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('DATABASE_URL present:', isPostgres);
if (isPostgres) console.log('DATABASE_URL length:', process.env.DATABASE_URL.length);
console.log('All Keys:', Object.keys(process.env).join(', '));
console.log('-------------------------');

if (process.env.NODE_ENV === 'production' && !isPostgres) {
    console.error('❌ FATAL: Running in production but DATABASE_URL is not set!');
    console.error('Data would be lost on restart. Exiting...');
    process.exit(1);
}

let pool, sqlite;

if (isPostgres) {
    const { Pool } = require('pg');
    pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });
    console.log('🐘 Using PostgreSQL database (Production/Persistent)');

    // Test connection immediately
    pool.query('SELECT NOW()').then(() => console.log('✅ DB Connected')).catch(e => {
        console.error('❌ DB Connection Failed:', e);
        process.exit(1);
    });

} else {
    const Database = require('better-sqlite3');
    sqlite = new Database(path.join(__dirname, 'nitknot.db'));
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('foreign_keys = ON');
    console.log('📁 Using SQLite database (Local/Ephemeral)');
}

// ========================================
// Unified Query Interface
// ========================================

// Convert `?` placeholders to $1, $2, ... for PostgreSQL
function convertPlaceholders(sql) {
    let i = 0;
    return sql.replace(/\?/g, () => `$${++i}`);
}

// Query returning multiple rows
async function query(sql, params = []) {
    if (isPostgres) {
        const res = await pool.query(convertPlaceholders(sql), params);
        return res.rows;
    } else {
        return sqlite.prepare(sql).all(...params);
    }
}

// Query returning single row or null
async function queryOne(sql, params = []) {
    if (isPostgres) {
        const res = await pool.query(convertPlaceholders(sql), params);
        return res.rows[0] || null;
    } else {
        return sqlite.prepare(sql).get(...params) || null;
    }
}

// Execute INSERT/UPDATE/DELETE, return { lastId, changes }
async function run(sql, params = []) {
    if (isPostgres) {
        // For INSERT, add RETURNING id to get lastId
        let modifiedSql = convertPlaceholders(sql);
        const isInsert = sql.trim().toUpperCase().startsWith('INSERT');
        if (isInsert && !modifiedSql.toUpperCase().includes('RETURNING')) {
            modifiedSql += ' RETURNING id';
        }
        const res = await pool.query(modifiedSql, params);
        return {
            lastId: res.rows[0]?.id || null,
            changes: res.rowCount
        };
    } else {
        const result = sqlite.prepare(sql).run(...params);
        return {
            lastId: result.lastInsertRowid,
            changes: result.changes
        };
    }
}

// ========================================
// Table Initialization
// ========================================
async function initTables() {
    if (isPostgres) {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                email TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                age INTEGER NOT NULL,
                gender TEXT NOT NULL,
                branch TEXT NOT NULL,
                year TEXT NOT NULL,
                bio TEXT DEFAULT '',
                photo TEXT DEFAULT '',
                show_me TEXT DEFAULT 'all',
                interests TEXT DEFAULT '[]',
                green_flags TEXT DEFAULT '[]',
                red_flags TEXT DEFAULT '[]',
                is_verified INTEGER DEFAULT 0,
                is_active INTEGER DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS swipes (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id),
                target_id INTEGER NOT NULL REFERENCES users(id),
                action TEXT NOT NULL CHECK(action IN ('like','pass')),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, target_id)
            );

            CREATE TABLE IF NOT EXISTS matches (
                id SERIAL PRIMARY KEY,
                user1_id INTEGER NOT NULL REFERENCES users(id),
                user2_id INTEGER NOT NULL REFERENCES users(id),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user1_id, user2_id)
            );

            CREATE TABLE IF NOT EXISTS messages (
                id SERIAL PRIMARY KEY,
                match_id INTEGER NOT NULL REFERENCES matches(id),
                sender_id INTEGER NOT NULL REFERENCES users(id),
                text TEXT NOT NULL,
                reply_to_id INTEGER REFERENCES messages(id),
                is_read INTEGER DEFAULT 0,
                image_url TEXT,
                voice_url TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS reports (
                id SERIAL PRIMARY KEY,
                reporter_id INTEGER NOT NULL REFERENCES users(id),
                reported_id INTEGER NOT NULL REFERENCES users(id),
                reason TEXT NOT NULL,
                details TEXT DEFAULT '',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE INDEX IF NOT EXISTS idx_swipes_user ON swipes(user_id);
            CREATE INDEX IF NOT EXISTS idx_swipes_target ON swipes(target_id);
            CREATE INDEX IF NOT EXISTS idx_matches_user1 ON matches(user1_id);
            CREATE INDEX IF NOT EXISTS idx_matches_user2 ON matches(user2_id);
            CREATE INDEX IF NOT EXISTS idx_messages_match ON messages(match_id);
        `);
    } else {
        sqlite.exec(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                email TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                age INTEGER NOT NULL,
                gender TEXT NOT NULL,
                branch TEXT NOT NULL,
                year TEXT NOT NULL,
                bio TEXT DEFAULT '',
                photo TEXT DEFAULT '',
                show_me TEXT DEFAULT 'all',
                interests TEXT DEFAULT '[]',
                green_flags TEXT DEFAULT '[]',
                red_flags TEXT DEFAULT '[]',
                is_verified INTEGER DEFAULT 0,
                is_active INTEGER DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS swipes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                target_id INTEGER NOT NULL,
                action TEXT NOT NULL CHECK(action IN ('like','pass')),
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id),
                FOREIGN KEY (target_id) REFERENCES users(id),
                UNIQUE(user_id, target_id)
            );

            CREATE TABLE IF NOT EXISTS matches (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user1_id INTEGER NOT NULL,
                user2_id INTEGER NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user1_id) REFERENCES users(id),
                FOREIGN KEY (user2_id) REFERENCES users(id),
                UNIQUE(user1_id, user2_id)
            );

            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                match_id INTEGER NOT NULL,
                sender_id INTEGER NOT NULL,
                text TEXT NOT NULL,
                reply_to_id INTEGER,
                is_read INTEGER DEFAULT 0,
                image_url TEXT,
                voice_url TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (match_id) REFERENCES matches(id),
                FOREIGN KEY (sender_id) REFERENCES users(id),
                FOREIGN KEY (reply_to_id) REFERENCES messages(id)
            );

            CREATE TABLE IF NOT EXISTS reports (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                reporter_id INTEGER NOT NULL,
                reported_id INTEGER NOT NULL,
                reason TEXT NOT NULL,
                details TEXT DEFAULT '',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (reporter_id) REFERENCES users(id),
                FOREIGN KEY (reported_id) REFERENCES users(id)
            );

            CREATE INDEX IF NOT EXISTS idx_swipes_user ON swipes(user_id);
            CREATE INDEX IF NOT EXISTS idx_swipes_target ON swipes(target_id);
            CREATE INDEX IF NOT EXISTS idx_matches_user1 ON matches(user1_id);
            CREATE INDEX IF NOT EXISTS idx_matches_user2 ON matches(user2_id);
            CREATE INDEX IF NOT EXISTS idx_messages_match ON messages(match_id);
        `);
    }

    // Auto-migration for is_active (for existing installs)
    try {
        if (isPostgres) {
            await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active INTEGER DEFAULT 1');
        } else {
            // SQLite throws if column exists
            sqlite.prepare('ALTER TABLE users ADD COLUMN is_active INTEGER DEFAULT 1').run();
        }
    } catch (e) {
        // Column likely exists
    }

    // Auto-migration for reply_to_id
    try {
        if (isPostgres) {
            await pool.query('ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_to_id INTEGER REFERENCES messages(id)');
        } else {
            sqlite.prepare('ALTER TABLE messages ADD COLUMN reply_to_id INTEGER REFERENCES messages(id)').run();
        }
    } catch (e) { }

    // Auto-migration for is_verified (Phase 4)
    try {
        if (isPostgres) {
            await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS is_verified INTEGER DEFAULT 0');
        } else {
            sqlite.prepare('ALTER TABLE users ADD COLUMN is_verified INTEGER DEFAULT 0').run();
        }
    } catch (e) { }

    // Auto-migration for is_super_like (Phase 4)
    try {
        if (isPostgres) {
            await pool.query('ALTER TABLE swipes ADD COLUMN IF NOT EXISTS is_super_like INTEGER DEFAULT 0');
        } else {
            sqlite.prepare('ALTER TABLE swipes ADD COLUMN is_super_like INTEGER DEFAULT 0').run();
        }
    } catch (e) { }

    // Auto-migration for is_read
    try {
        if (isPostgres) {
            await pool.query('ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_read INTEGER DEFAULT 0');
        } else {
            sqlite.prepare('ALTER TABLE messages ADD COLUMN is_read INTEGER DEFAULT 0').run();
        }
    } catch (e) { }

    // Auto-migration for image_url and voice_url
    try {
        if (isPostgres) {
            await pool.query('ALTER TABLE messages ADD COLUMN IF NOT EXISTS image_url TEXT');
            await pool.query('ALTER TABLE messages ADD COLUMN IF NOT EXISTS voice_url TEXT');
        } else {
            sqlite.prepare('ALTER TABLE messages ADD COLUMN image_url TEXT').run();
            sqlite.prepare('ALTER TABLE messages ADD COLUMN voice_url TEXT').run();
        }
    } catch (e) { }

    console.log('✅ Database tables initialized');
}

module.exports = { query, queryOne, run, initTables, isPostgres };
