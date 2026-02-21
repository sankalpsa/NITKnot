// ========================================
// NITKnot — Production Server (Fixed)
// ========================================
require('dotenv').config();
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const nodemailer = require('nodemailer');
const http = require('http');
const { Server } = require('socket.io');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const db = require('./db');

// ========================================
// OTP Storage
// ========================================
const otpStore = new Map();
const OTP_EXPIRY_MS = 10 * 60 * 1000;

function generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

setInterval(() => {
    const now = Date.now();
    for (const [email, data] of otpStore.entries()) {
        if (now > data.expiresAt) otpStore.delete(email);
    }
}, 5 * 60 * 1000);

// ========================================
// Email Setup
// ========================================
const OTP_HTML = (otp) => `
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#1a1a2e;border-radius:16px;color:#fff;">
        <h1 style="text-align:center;color:#ee2b9d;">NITKnot 💕</h1>
        <p style="text-align:center;color:#ccc;">Your verification code is:</p>
        <div style="text-align:center;font-size:36px;font-weight:bold;letter-spacing:8px;color:#ee2b9d;background:#16213e;padding:20px;border-radius:12px;margin:20px 0;">
            ${otp}
        </div>
        <p style="text-align:center;color:#888;font-size:14px;">This code expires in 10 minutes.<br>If you didn't request this, please ignore this email.</p>
    </div>
`;

async function sendOTPEmail(toEmail, otp) {
    if (process.env.SENDGRID_API_KEY && process.env.SENDGRID_API_KEY.trim() !== '') {
        const senderEmail = process.env.SMTP_EMAIL || 'noreply@nitknot.com';
        try {
            const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${process.env.SENDGRID_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    personalizations: [{ to: [{ email: toEmail }] }],
                    from: { email: senderEmail, name: 'NITKnot 💕' },
                    subject: '🔐 NITKnot - Your Verification Code',
                    content: [{ type: 'text/html', value: OTP_HTML(otp) }]
                })
            });
            if (res.ok) { console.log(`✅ SendGrid email sent to ${toEmail}`); return; }
            else { const err = await res.text(); console.warn(`⚠️ SendGrid error: ${err}`); }
        } catch (error) { console.warn('⚠️ SendGrid failed, falling back to SMTP', error); }
    }

    try {
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: { user: process.env.SMTP_EMAIL || '', pass: process.env.SMTP_PASSWORD || '' },
            tls: { rejectUnauthorized: false },
            family: 4
        });
        await transporter.sendMail({
            from: `"NITKnot 💕" <${process.env.SMTP_EMAIL}>`,
            to: toEmail, subject: '🔐 NITKnot - Your Verification Code', html: OTP_HTML(otp)
        });
        console.log(`✅ SMTP email sent to ${toEmail}`);
    } catch (smtpError) {
        console.error('❌ SMTP Email Fatal Error:', smtpError);
        throw smtpError;
    }
}

// ========================================
// Server & Socket Setup
// ========================================
const app = express();
app.set('trust proxy', 1);
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'nitknot_dev_secret_change_in_production';

const onlineUsers = new Set();

io.on('connection', (socket) => {
    socket.on('register', (userId) => {
        if (userId) {
            socket.userId = userId.toString();
            socket.join(socket.userId);
            onlineUsers.add(socket.userId);
            io.emit('online_status', { userId: socket.userId, online: true });
        }
    });

    socket.on('disconnect', () => {
        if (socket.userId) {
            onlineUsers.delete(socket.userId);
            io.emit('online_status', { userId: socket.userId, online: false });
        }
    });

    socket.on('typing_start', ({ toUserId }) => {
        if (!socket.userId) return;
        io.to(toUserId.toString()).emit('typing_start', { fromUserId: socket.userId });
    });

    socket.on('typing_stop', ({ toUserId }) => {
        if (!socket.userId) return;
        io.to(toUserId.toString()).emit('typing_stop', { fromUserId: socket.userId });
    });
});

// ========================================
// Middleware
// ========================================
app.use(cors());
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve static from public/ directory
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    next();
});

const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 2000, message: { error: 'Too many requests' } });
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100, message: { error: 'Too many auth attempts' } });
const otpLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: { error: 'Too many OTP requests.' } });
app.use('/api/', apiLimiter);
app.use('/api/auth/', authLimiter);

// ========================================
// File Storage
// ========================================
let storage;
const useCloudinary = process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET;

if (useCloudinary) {
    cloudinary.config({
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
        api_key: process.env.CLOUDINARY_API_KEY,
        api_secret: process.env.CLOUDINARY_API_SECRET
    });
    storage = new CloudinaryStorage({
        cloudinary,
        params: {
            folder: 'nitknot-photos',
            allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
            transformation: [{ width: 800, height: 800, crop: 'limit', quality: 'auto' }]
        }
    });
    console.log('📸 Using Cloudinary for image storage');
} else {
    const uploadsDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
    storage = multer.diskStorage({
        destination: (req, file, cb) => cb(null, uploadsDir),
        filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.round(Math.random() * 1E6)}${path.extname(file.originalname)}`)
    });
    console.log('⚠️  Using local disk for image storage');
}

const fileFilter = (req, file, cb) => {
    const allowedImage = /jpeg|jpg|png|webp/;
    const allowedAudio = /webm|mp4|ogg|wav|mpeg|mp3/;
    const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
    if (file.fieldname === 'audio' && (allowedAudio.test(ext) || file.mimetype.startsWith('audio/'))) {
        cb(null, true);
    } else if (allowedImage.test(ext) && allowedImage.test(file.mimetype.split('/')[1])) {
        cb(null, true);
    } else {
        cb(null, false); // Silently skip instead of error
    }
};

const upload = multer({
    storage,
    limits: { fileSize: (process.env.MAX_UPLOAD_SIZE || 10) * 1024 * 1024 },
    fileFilter
});

// Audio uses disk even in cloudinary mode (voice messages)
const audioStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = path.join(__dirname, 'uploads');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (req, file, cb) => cb(null, `voice-${Date.now()}-${Math.round(Math.random() * 1E6)}.webm`)
});

const uploadMsg = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => {
            const dir = path.join(__dirname, 'uploads');
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            cb(null, dir);
        },
        filename: (req, file, cb) => {
            const ext = path.extname(file.originalname) || (file.mimetype.startsWith('audio/') ? '.webm' : '.jpg');
            cb(null, `${file.fieldname}-${Date.now()}${ext}`);
        }
    }),
    limits: { fileSize: 15 * 1024 * 1024 },
    fileFilter: (req, file, cb) => cb(null, true)
});

// ========================================
// Auth Middleware
// ========================================
async function authenticate(req, res, next) {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) return res.status(401).json({ error: 'Not authenticated' });
    try {
        const payload = jwt.verify(header.split(' ')[1], JWT_SECRET);
        const user = await db.queryOne('SELECT * FROM users WHERE id = ? AND is_active = 1', [payload.userId]);
        if (!user) return res.status(401).json({ error: 'User not found' });
        req.user = user;
        next();
    } catch (e) {
        return res.status(401).json({ error: 'Invalid token' });
    }
}

function sanitizeUser(u) {
    const { password, ...safe } = u;
    try { safe.interests = typeof safe.interests === 'string' ? JSON.parse(safe.interests || '[]') : (safe.interests || []); } catch { safe.interests = []; }
    try { safe.green_flags = typeof safe.green_flags === 'string' ? JSON.parse(safe.green_flags || '[]') : (safe.green_flags || []); } catch { safe.green_flags = []; }
    try { safe.red_flags = typeof safe.red_flags === 'string' ? JSON.parse(safe.red_flags || '[]') : (safe.red_flags || []); } catch { safe.red_flags = []; }
    return safe;
}

// ========================================
// AUTH ROUTES
// ========================================

app.post('/api/auth/send-otp', otpLimiter, async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ error: 'Email is required' });
        const normalizedEmail = email.toLowerCase().trim();
        if (!normalizedEmail.endsWith('@nitk.edu.in')) {
            return res.status(400).json({ error: 'Only @nitk.edu.in emails are allowed.' });
        }
        const existing = await db.queryOne('SELECT id FROM users WHERE email = ?', [normalizedEmail]);
        if (existing) return res.status(409).json({ error: 'Email already registered. Please login.' });

        const otp = generateOTP();
        otpStore.set(normalizedEmail, { otp, expiresAt: Date.now() + OTP_EXPIRY_MS, verified: false });

        try {
            await sendOTPEmail(normalizedEmail, otp);
        } catch (mailErr) {
            console.error('Email send error:', mailErr);
            if (process.env.NODE_ENV !== 'production') {
                console.log(`⚠️  DEV MODE — OTP for ${normalizedEmail}: ${otp}`);
            } else {
                return res.status(500).json({ error: 'Failed to send verification email. Please try again.' });
            }
        }
        res.json({ success: true, message: 'OTP sent!' });
    } catch (e) {
        console.error('Send OTP error:', e);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/auth/verify-otp', (req, res) => {
    try {
        const { email, otp } = req.body;
        if (!email || !otp) return res.status(400).json({ error: 'Email and OTP required' });
        const normalizedEmail = email.toLowerCase().trim();
        const stored = otpStore.get(normalizedEmail);
        if (!stored) return res.status(400).json({ error: 'No OTP found. Request a new one.' });
        if (Date.now() > stored.expiresAt) { otpStore.delete(normalizedEmail); return res.status(400).json({ error: 'OTP expired. Request a new one.' }); }
        if (stored.otp !== otp.trim()) return res.status(400).json({ error: 'Incorrect OTP. Try again.' });
        stored.verified = true;
        otpStore.set(normalizedEmail, stored);
        res.json({ success: true, message: 'Email verified!' });
    } catch (e) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/auth/register', async (req, res) => {
    try {
        const { name, email, password, age, gender, branch, year, bio, show_me, interests, green_flags, red_flags } = req.body;
        if (!name || !email || !password || !age || !gender || !branch || !year)
            return res.status(400).json({ error: 'All fields are required' });

        const normalizedEmail = email.toLowerCase().trim();
        if (!normalizedEmail.endsWith('@nitk.edu.in'))
            return res.status(400).json({ error: 'Only @nitk.edu.in emails allowed.' });

        const otpData = otpStore.get(normalizedEmail);
        if (!otpData || !otpData.verified)
            return res.status(403).json({ error: 'Email not verified. Verify OTP first.' });

        if (password.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters' });
        if (age < 18 || age > 35) return res.status(400).json({ error: 'Must be 18+ years old' });

        const existing = await db.queryOne('SELECT id FROM users WHERE email = ?', [normalizedEmail]);
        if (existing) return res.status(409).json({ error: 'Email already registered' });

        const hash = bcrypt.hashSync(password, 10);
        const result = await db.run(
            `INSERT INTO users (name, email, password, age, gender, branch, year, bio, show_me, interests, green_flags, red_flags, is_verified)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                name, normalizedEmail, hash, age, gender, branch, year,
                bio || "Hey there! I'm on NITKnot 💕",
                show_me || 'all',
                JSON.stringify(interests || []),
                JSON.stringify(green_flags || []),
                JSON.stringify(red_flags || []),
                1
            ]
        );

        otpStore.delete(normalizedEmail);
        const token = jwt.sign({ userId: result.lastId }, JWT_SECRET, { expiresIn: '30d' });
        const user = await db.queryOne('SELECT * FROM users WHERE id = ?', [result.lastId]);
        res.status(201).json({ token, user: sanitizeUser(user) });
    } catch (e) {
        console.error('Register error:', e);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
        const user = await db.queryOne('SELECT * FROM users WHERE email = ?', [email.toLowerCase().trim()]);
        if (!user || !bcrypt.compareSync(password, user.password)) return res.status(401).json({ error: 'Invalid email or password' });
        if (user.is_active === 0) {
            await db.run('UPDATE users SET is_active = 1 WHERE id = ?', [user.id]);
            user.is_active = 1;
        }
        const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' });
        res.json({ token, user: sanitizeUser(user) });
    } catch (e) {
        console.error('Login error:', e);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/auth/forgot-password', authLimiter, async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ error: 'Email required' });
        const user = await db.queryOne('SELECT * FROM users WHERE email = ?', [email.toLowerCase().trim()]);
        if (!user) return res.status(404).json({ error: 'No account found with this email' });
        const tempPass = Math.random().toString(36).slice(-8);
        const hashed = bcrypt.hashSync(tempPass, 10);
        await db.run('UPDATE users SET password = ? WHERE id = ?', [hashed, user.id]);
        try {
            await sendOTPEmail(email, `Your temporary password is: <strong>${tempPass}</strong><br>Login and change it immediately.`);
        } catch (e) {
            if (process.env.NODE_ENV !== 'production') console.log(`DEV: temp pass = ${tempPass}`);
        }
        res.json({ success: true, message: 'Temporary password sent to your email' });
    } catch (e) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/auth/me', authenticate, (req, res) => {
    res.json({ user: sanitizeUser(req.user) });
});

// ========================================
// PROFILE ROUTES
// ========================================

app.put('/api/profile', authenticate, async (req, res) => {
    try {
        const { name, bio, branch, year, show_me, interests, green_flags, red_flags } = req.body;
        await db.run(
            `UPDATE users SET name=COALESCE(?,name), bio=COALESCE(?,bio), branch=COALESCE(?,branch),
             year=COALESCE(?,year), show_me=COALESCE(?,show_me),
             interests=COALESCE(?,interests), green_flags=COALESCE(?,green_flags), red_flags=COALESCE(?,red_flags)
             WHERE id=?`,
            [
                name || null, bio || null, branch || null, year || null, show_me || null,
                interests ? JSON.stringify(interests) : null,
                green_flags ? JSON.stringify(green_flags) : null,
                red_flags ? JSON.stringify(red_flags) : null,
                req.user.id
            ]
        );
        const updated = await db.queryOne('SELECT * FROM users WHERE id = ?', [req.user.id]);
        res.json({ user: sanitizeUser(updated) });
    } catch (e) {
        console.error('Update profile error:', e);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/profile/photo', authenticate, upload.single('photo'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
        const photoUrl = req.file.path && req.file.path.startsWith('http') ? req.file.path : `/uploads/${req.file.filename}`;
        await db.run('UPDATE users SET photo = ? WHERE id = ?', [photoUrl, req.user.id]);
        res.json({ photo: photoUrl });
    } catch (e) {
        console.error('Upload error:', e);
        res.status(500).json({ error: 'Upload failed' });
    }
});

// ========================================
// DISCOVER ROUTES
// ========================================

app.get('/api/discover', authenticate, async (req, res) => {
    try {
        const userId = req.user.id;
        const showMe = req.user.show_me;
        let genderFilter = '';
        if (showMe === 'male') genderFilter = "AND u.gender = 'male'";
        else if (showMe === 'female') genderFilter = "AND u.gender = 'female'";

        // Cross-DB compatible random ordering
        const randomFn = db.isPostgres ? 'RANDOM()' : 'RANDOM()';

        const profiles = await db.query(
            `SELECT u.* FROM users u
             WHERE u.id != ?
               AND u.is_active = 1
               AND u.id NOT IN (SELECT target_id FROM swipes WHERE user_id = ?)
               AND u.id NOT IN (
                 SELECT CASE WHEN user1_id = ? THEN user2_id ELSE user1_id END
                 FROM matches WHERE user1_id = ? OR user2_id = ?
               )
               ${genderFilter}
             ORDER BY ${randomFn}
             LIMIT 20`,
            [userId, userId, userId, userId, userId]
        );

        const userInterests = req.user.interests ? JSON.parse(req.user.interests) : [];
        const result = profiles.map(p => {
            const s = sanitizeUser(p);
            const shared = s.interests.filter(i => userInterests.includes(i));
            s.match_percent = userInterests.length > 0
                ? Math.min(99, Math.round((shared.length / Math.max(userInterests.length, 1)) * 100 + 40))
                : Math.floor(60 + Math.random() * 30);
            s.shared_interests = shared;
            return s;
        });

        res.json({ profiles: result });
    } catch (e) {
        console.error('Discover error:', e);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/swipe', authenticate, async (req, res) => {
    try {
        const { target_id, action } = req.body;
        if (!target_id || !['like', 'pass', 'super_like'].includes(action))
            return res.status(400).json({ error: 'Invalid request' });

        const userId = req.user.id;
        const targetId = parseInt(target_id);
        const isSuperLike = action === 'super_like';
        const dbAction = isSuperLike ? 'like' : action;

        // Check if target exists
        const targetUser = await db.queryOne('SELECT id, name, photo FROM users WHERE id = ?', [targetId]);
        if (!targetUser) return res.status(404).json({ error: 'User not found' });

        const existing = await db.queryOne('SELECT id FROM swipes WHERE user_id = ? AND target_id = ?', [userId, targetId]);
        if (existing) return res.json({ success: false, message: 'Already swiped' });

        await db.run(
            'INSERT INTO swipes (user_id, target_id, action, is_super_like) VALUES (?, ?, ?, ?)',
            [userId, targetId, dbAction, isSuperLike ? 1 : 0]
        );

        let isMatch = false;
        let matchId = null;
        let matchedUser = null;

        if (dbAction === 'like') {
            const otherSwipe = await db.queryOne(
                "SELECT * FROM swipes WHERE user_id = ? AND target_id = ? AND action = 'like'",
                [targetId, userId]
            );

            if (otherSwipe) {
                isMatch = true;
                const u1 = Math.min(userId, targetId);
                const u2 = Math.max(userId, targetId);
                const result = await db.run('INSERT INTO matches (user1_id, user2_id) VALUES (?, ?)', [u1, u2]);
                matchId = result.lastId;
                matchedUser = await db.queryOne('SELECT id, name, photo, branch, year, bio FROM users WHERE id = ?', [targetId]);
                const matchedUserSafe = sanitizeUser({ ...matchedUser, password: '' });

                // Notify both users via socket with full data
                io.to(userId.toString()).emit('match_found', {
                    match_id: matchId,
                    user: matchedUserSafe
                });
                io.to(targetId.toString()).emit('match_found', {
                    match_id: matchId,
                    user: sanitizeUser({ ...req.user, password: '' })
                });
            } else if (isSuperLike) {
                io.to(targetId.toString()).emit('super_like_received', {
                    fromUserId: userId,
                    name: req.user.name,
                    photo: req.user.photo
                });
            }
        }

        res.json({
            success: true,
            match: isMatch,
            match_id: matchId,
            matched_user: matchedUser ? sanitizeUser({ ...matchedUser, password: '' }) : null
        });
    } catch (e) {
        console.error('Swipe error:', e);
        res.status(500).json({ error: 'Server error' });
    }
});

// ========================================
// LIKES ROUTES
// ========================================

app.get('/api/likes/received', authenticate, async (req, res) => {
    try {
        const userId = req.user.id;
        const likes = await db.query(
            `SELECT u.*, s.is_super_like, s.created_at as liked_at
             FROM swipes s
             JOIN users u ON s.user_id = u.id
             WHERE s.target_id = ?
             AND s.action = 'like'
             AND u.is_active = 1
             AND s.user_id NOT IN (
               SELECT CASE WHEN user1_id = ? THEN user2_id ELSE user1_id END
               FROM matches WHERE user1_id = ? OR user2_id = ?
             )
             ORDER BY s.is_super_like DESC, s.created_at DESC`,
            [userId, userId, userId, userId]
        );
        const result = likes.map(p => ({ ...sanitizeUser(p), is_super_like: p.is_super_like === 1 }));
        res.json(result);
    } catch (e) {
        console.error('Likes error:', e);
        res.status(500).json({ error: 'Server error' });
    }
});

// ========================================
// MATCHES ROUTES
// ========================================

app.get('/api/matches', authenticate, async (req, res) => {
    try {
        const userId = req.user.id;
        const matches = await db.query(
            `SELECT m.id as match_id, m.created_at as matched_at,
                CASE WHEN m.user1_id = ? THEN u2.id ELSE u1.id END as user_id,
                CASE WHEN m.user1_id = ? THEN u2.name ELSE u1.name END as name,
                CASE WHEN m.user1_id = ? THEN u2.photo ELSE u1.photo END as photo,
                CASE WHEN m.user1_id = ? THEN u2.branch ELSE u1.branch END as branch,
                CASE WHEN m.user1_id = ? THEN u2.year ELSE u1.year END as year,
                CASE WHEN m.user1_id = ? THEN u2.bio ELSE u1.bio END as bio,
                CASE WHEN m.user1_id = ? THEN u2.age ELSE u1.age END as age,
                CASE WHEN m.user1_id = ? THEN u2.interests ELSE u1.interests END as interests,
                CASE WHEN m.user1_id = ? THEN u2.green_flags ELSE u1.green_flags END as green_flags,
                CASE WHEN m.user1_id = ? THEN u2.red_flags ELSE u1.red_flags END as red_flags,
                CASE WHEN m.user1_id = ? THEN u2.gender ELSE u1.gender END as gender
             FROM matches m
             JOIN users u1 ON m.user1_id = u1.id
             JOIN users u2 ON m.user2_id = u2.id
             WHERE (m.user1_id = ? OR m.user2_id = ?)`,
            [userId, userId, userId, userId, userId, userId, userId, userId, userId, userId, userId, userId, userId]
        );

        const result = [];
        for (const m of matches) {
            try {
                const lastMsg = await db.queryOne(
                    'SELECT text, created_at, sender_id FROM messages WHERE match_id = ? ORDER BY created_at DESC LIMIT 1',
                    [m.match_id]
                );
                const unreadCount = await db.queryOne(
                    "SELECT COUNT(*) as c FROM messages WHERE match_id = ? AND sender_id != ? AND is_read = 0",
                    [m.match_id, userId]
                );
                result.push({
                    ...m,
                    last_message: lastMsg ? lastMsg.text : null,
                    last_message_time: lastMsg ? lastMsg.created_at : null,
                    last_message_mine: lastMsg ? lastMsg.sender_id === userId : false,
                    unread_count: unreadCount ? unreadCount.c : 0,
                    interests: m.interests ? (typeof m.interests === 'string' ? JSON.parse(m.interests) : m.interests) : [],
                    green_flags: m.green_flags ? (typeof m.green_flags === 'string' ? JSON.parse(m.green_flags) : m.green_flags) : [],
                    red_flags: m.red_flags ? (typeof m.red_flags === 'string' ? JSON.parse(m.red_flags) : m.red_flags) : [],
                });
            } catch (err) {
                console.error('Error processing match:', m.match_id, err);
                result.push({ ...m, interests: [], green_flags: [], red_flags: [], unread_count: 0 });
            }
        }

        result.sort((a, b) => {
            const timeA = new Date(a.last_message_time || a.matched_at).getTime();
            const timeB = new Date(b.last_message_time || b.matched_at).getTime();
            return timeB - timeA;
        });

        res.json({ matches: result });
    } catch (e) {
        console.error('Matches error:', e);
        res.status(500).json({ error: 'Server error' });
    }
});

app.delete('/api/matches/:id', authenticate, async (req, res) => {
    try {
        const matchId = parseInt(req.params.id);
        const userId = req.user.id;
        const match = await db.queryOne('SELECT id FROM matches WHERE id = ? AND (user1_id = ? OR user2_id = ?)', [matchId, userId, userId]);
        if (!match) return res.status(404).json({ error: 'Match not found' });
        await db.run('DELETE FROM messages WHERE match_id = ?', [matchId]);
        await db.run('DELETE FROM matches WHERE id = ?', [matchId]);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Server error' });
    }
});

// ========================================
// MESSAGES ROUTES
// ========================================

app.get('/api/messages/:matchId', authenticate, async (req, res) => {
    try {
        const matchId = parseInt(req.params.matchId);
        const userId = req.user.id;
        const match = await db.queryOne('SELECT * FROM matches WHERE id = ? AND (user1_id = ? OR user2_id = ?)', [matchId, userId, userId]);
        if (!match) return res.status(403).json({ error: 'Not your match' });

        const messages = await db.query(
            `SELECT m.*, u.name as sender_name, u.photo as sender_photo,
                    rm.text as reply_to_text,
                    ru.name as reply_to_sender
             FROM messages m
             JOIN users u ON m.sender_id = u.id
             LEFT JOIN messages rm ON m.reply_to_id = rm.id
             LEFT JOIN users ru ON rm.sender_id = ru.id
             WHERE m.match_id = ?
             ORDER BY m.created_at ASC`,
            [matchId]
        );

        res.json({ messages, match });
    } catch (e) {
        console.error('Messages error:', e);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/messages/:matchId', authenticate,
    uploadMsg.fields([{ name: 'image', maxCount: 1 }, { name: 'audio', maxCount: 1 }]),
    async (req, res) => {
        try {
            const matchId = parseInt(req.params.matchId);
            const userId = req.user.id;
            const { text, replyToId } = req.body;

            const imageFile = req.files && req.files['image'] ? req.files['image'][0] : null;
            const audioFile = req.files && req.files['audio'] ? req.files['audio'][0] : null;

            let imageUrl = null, voiceUrl = null;
            if (imageFile) {
                // If Cloudinary, upload image; otherwise serve locally
                if (useCloudinary) {
                    try {
                        const result = await cloudinary.uploader.upload(imageFile.path, {
                            folder: 'nitknot-chat',
                            transformation: [{ width: 1200, quality: 'auto' }]
                        });
                        imageUrl = result.secure_url;
                        fs.unlink(imageFile.path, () => {});
                    } catch { imageUrl = `/uploads/${imageFile.filename}`; }
                } else {
                    imageUrl = `/uploads/${imageFile.filename}`;
                }
            }
            if (audioFile) voiceUrl = `/uploads/${audioFile.filename}`;

            const msgText = (text || '').trim();
            if (!msgText && !imageUrl && !voiceUrl)
                return res.status(400).json({ error: 'Message cannot be empty' });

            if (msgText.length > 2000)
                return res.status(400).json({ error: 'Message too long (max 2000 chars)' });

            const match = await db.queryOne('SELECT * FROM matches WHERE id = ? AND (user1_id = ? OR user2_id = ?)', [matchId, userId, userId]);
            if (!match) return res.status(403).json({ error: 'Not your match' });

            const result = await db.run(
                'INSERT INTO messages (match_id, sender_id, text, reply_to_id, image_url, voice_url) VALUES (?, ?, ?, ?, ?, ?)',
                [matchId, userId, msgText, replyToId ? parseInt(replyToId) : null, imageUrl, voiceUrl]
            );

            const message = await db.queryOne(
                `SELECT m.*, u.name as sender_name, u.photo as sender_photo,
                        rm.text as reply_to_text, ru.name as reply_to_sender
                 FROM messages m
                 JOIN users u ON m.sender_id = u.id
                 LEFT JOIN messages rm ON m.reply_to_id = rm.id
                 LEFT JOIN users ru ON rm.sender_id = ru.id
                 WHERE m.id = ?`,
                [result.lastId]
            );

            const otherId = match.user1_id === userId ? match.user2_id : match.user1_id;
            io.to(otherId.toString()).emit('new_message', message);
            io.to(userId.toString()).emit('message_sent', message);

            res.status(201).json({ message });
        } catch (e) {
            console.error('Send message error:', e);
            res.status(500).json({ error: 'Server error' });
        }
    }
);

app.delete('/api/messages/:id', authenticate, async (req, res) => {
    try {
        const msgId = parseInt(req.params.id);
        const userId = req.user.id;
        const result = await db.run('DELETE FROM messages WHERE id = ? AND sender_id = ?', [msgId, userId]);
        if (result.changes === 0) return res.status(404).json({ error: 'Message not found or not yours' });

        // Notify others in match
        const msg = await db.queryOne('SELECT match_id FROM messages WHERE id = ?', [msgId]);
        if (msg) {
            io.emit('message_deleted', { messageId: msgId, matchId: msg.match_id });
        }

        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/messages/:matchId/read', authenticate, async (req, res) => {
    try {
        const matchId = parseInt(req.params.matchId);
        const userId = req.user.id;
        const result = await db.run(
            'UPDATE messages SET is_read = 1 WHERE match_id = ? AND sender_id != ? AND is_read = 0',
            [matchId, userId]
        );
        if (result.changes > 0) {
            const match = await db.queryOne('SELECT * FROM matches WHERE id = ?', [matchId]);
            if (match) {
                const otherId = match.user1_id === userId ? match.user2_id : match.user1_id;
                io.to(otherId.toString()).emit('messages_read', { matchId, readBy: userId });
            }
        }
        res.json({ success: true, changes: result.changes });
    } catch (e) {
        res.status(500).json({ error: 'Server error' });
    }
});

// ========================================
// REPORT & BLOCK
// ========================================

app.post('/api/report', authenticate, async (req, res) => {
    try {
        const { reported_id, reason, details } = req.body;
        if (!reported_id || !reason) return res.status(400).json({ error: 'Missing fields' });
        await db.run('INSERT INTO reports (reporter_id, reported_id, reason, details) VALUES (?, ?, ?, ?)',
            [req.user.id, reported_id, reason, details || '']);
        res.json({ success: true, message: 'Report submitted. We\'ll review it soon.' });
    } catch (e) {
        res.status(500).json({ error: 'Server error' });
    }
});

// ========================================
// STATS
// ========================================

app.get('/api/stats', authenticate, async (req, res) => {
    try {
        const userId = req.user.id;
        const matchRow = await db.queryOne('SELECT COUNT(*) as c FROM matches WHERE user1_id = ? OR user2_id = ?', [userId, userId]);
        const likesRow = await db.queryOne("SELECT COUNT(*) as c FROM swipes WHERE user_id = ? AND action = 'like'", [userId]);
        const receivedRow = await db.queryOne("SELECT COUNT(*) as c FROM swipes WHERE target_id = ? AND action = 'like'", [userId]);
        res.json({
            matches: matchRow ? matchRow.c : 0,
            likes_given: likesRow ? likesRow.c : 0,
            likes_received: receivedRow ? receivedRow.c : 0
        });
    } catch (e) {
        res.status(500).json({ error: 'Server error' });
    }
});

// ========================================
// ACCOUNT MANAGEMENT
// ========================================

app.post('/api/account/deactivate', authenticate, async (req, res) => {
    try {
        await db.run('UPDATE users SET is_active = 0 WHERE id = ?', [req.user.id]);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.delete('/api/account', authenticate, async (req, res) => {
    try {
        const userId = req.user.id;
        await db.run('DELETE FROM swipes WHERE user_id = ? OR target_id = ?', [userId, userId]);
        const userMatches = await db.query('SELECT id FROM matches WHERE user1_id = ? OR user2_id = ?', [userId, userId]);
        const matchIds = userMatches.map(m => m.id);
        if (matchIds.length > 0) {
            const ph = matchIds.map(() => '?').join(',');
            await db.run(`DELETE FROM messages WHERE match_id IN (${ph})`, matchIds);
            await db.run(`DELETE FROM matches WHERE id IN (${ph})`, matchIds);
        }
        await db.run('DELETE FROM reports WHERE reporter_id = ? OR reported_id = ?', [userId, userId]);
        await db.run('DELETE FROM users WHERE id = ?', [userId]);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Server error' });
    }
});

// ========================================
// ONLINE STATUS
// ========================================

app.get('/api/users/:id/online', authenticate, (req, res) => {
    res.json({ online: onlineUsers.has(req.params.id) });
});

// ========================================
// SPA fallback
// ========================================
app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    } else {
        res.status(404).json({ error: 'Not found' });
    }
});

// ========================================
// Start
// ========================================
async function start() {
    await db.initTables();
    server.listen(PORT, () => {
        console.log(`\n🚀 NITKnot running at http://localhost:${PORT}`);
        console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}\n`);
    });
}

start().catch(err => {
    console.error('Failed to start:', err);
    process.exit(1);
});
