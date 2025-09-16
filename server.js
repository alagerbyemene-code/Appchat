const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// إعدادات الخادم
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    console.error('❌ JWT_SECRET environment variable is required');
    process.exit(1);
}
const UPLOADS_DIR = path.join(__dirname, 'uploads');

// التأكد من وجود مجلد الرفع
if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// الوسائل الأساسية
app.use(cors({
    origin: process.env.NODE_ENV === 'production' ? 
        ['https://your-frontend-domain.com'] : 
        true, // Allow all origins in development
    credentials: true
}));
app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// إعداد رفع الملفات
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, UPLOADS_DIR);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB
    },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Only image files are allowed'));
        }
    }
});

// قاعدة البيانات
const db = new sqlite3.Database('chat.db');

// إنشاء الجداول
db.serialize(() => {
    // جدول المستخدمين
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE,
            display_name TEXT NOT NULL,
            password_hash TEXT,
            rank INTEGER DEFAULT 1,
            points INTEGER DEFAULT 0,
            profile_image TEXT,
            background_image TEXT,
            status_message TEXT DEFAULT '',
            join_date DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_active DATETIME DEFAULT CURRENT_TIMESTAMP,
            is_banned INTEGER DEFAULT 0,
            ban_reason TEXT,
            is_muted INTEGER DEFAULT 0,
            mute_until DATETIME,
            is_guest INTEGER DEFAULT 0,
            guest_id TEXT,
            profile_music TEXT,
            message_background TEXT,
            audio_settings TEXT DEFAULT '{"private":true,"public":true,"call":true,"notification":true}',
            theme_settings TEXT DEFAULT '{"theme":"dark","background":"default"}'
        )
    `);

    // جدول الغرف
    db.run(`
        CREATE TABLE IF NOT EXISTS rooms (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            description TEXT,
            creator_id INTEGER,
            is_quiz_room INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (creator_id) REFERENCES users (id)
        )
    `);

    // جدول الرسائل
    db.run(`
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            room_id INTEGER,
            message TEXT NOT NULL,
            image_url TEXT,
            quoted_message_id INTEGER,
            quoted_author TEXT,
            quoted_content TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            is_deleted INTEGER DEFAULT 0,
            FOREIGN KEY (user_id) REFERENCES users (id),
            FOREIGN KEY (room_id) REFERENCES rooms (id)
        )
    `);

    // جدول الرسائل الخاصة
    db.run(`
        CREATE TABLE IF NOT EXISTS private_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sender_id INTEGER,
            receiver_id INTEGER,
            message TEXT NOT NULL,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            is_read INTEGER DEFAULT 0,
            FOREIGN KEY (sender_id) REFERENCES users (id),
            FOREIGN KEY (receiver_id) REFERENCES users (id)
        )
    `);

    // جدول الأخبار/القصص
    db.run(`
        CREATE TABLE IF NOT EXISTS stories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            content TEXT NOT NULL,
            image_url TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            likes INTEGER DEFAULT 0,
            dislikes INTEGER DEFAULT 0,
            FOREIGN KEY (user_id) REFERENCES users (id)
        )
    `);

    // جدول تفاعلات القصص
    db.run(`
        CREATE TABLE IF NOT EXISTS story_reactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            story_id INTEGER,
            user_id INTEGER,
            reaction_type TEXT, -- 'like', 'dislike', 'love'
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (story_id) REFERENCES stories (id),
            FOREIGN KEY (user_id) REFERENCES users (id),
            UNIQUE(story_id, user_id)
        )
    `);

    // جدول تعليقات القصص
    db.run(`
        CREATE TABLE IF NOT EXISTS story_comments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            story_id INTEGER,
            user_id INTEGER,
            comment TEXT NOT NULL,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (story_id) REFERENCES stories (id),
            FOREIGN KEY (user_id) REFERENCES users (id)
        )
    `);

    // جدول المسابقات
    db.run(`
        CREATE TABLE IF NOT EXISTS quiz_questions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            question TEXT NOT NULL,
            option_a TEXT NOT NULL,
            option_b TEXT NOT NULL,
            option_c TEXT NOT NULL,
            option_d TEXT NOT NULL,
            correct_answer TEXT NOT NULL,
            points INTEGER DEFAULT 10,
            difficulty TEXT DEFAULT 'medium',
            category TEXT DEFAULT 'general'
        )
    `);

    // جدول الإشعارات
    db.run(`
        CREATE TABLE IF NOT EXISTS notifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            title TEXT NOT NULL,
            message TEXT NOT NULL,
            type TEXT DEFAULT 'info',
            is_read INTEGER DEFAULT 0,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id)
        )
    `);

    // جدول سجل نشاط المستخدمين (للحماية من الفيضانات)
    db.run(`
        CREATE TABLE IF NOT EXISTS user_activity (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            activity_type TEXT, -- 'message', 'private_message', 'story'
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id)
        )
    `);

    // إدخال الغرف الافتراضية
    db.run(`
        INSERT OR IGNORE INTO rooms (id, name, description) VALUES 
        (1, 'الغرفة العامة', 'غرفة الدردشة الرئيسية'),
        (2, 'غرفة المسابقات', 'غرفة المسابقات والألعاب')
    `, function(err) {
        if (!err && this.changes > 0) {
            // تحديث الغرفة الثانية لتكون غرفة مسابقات
            db.run(`UPDATE rooms SET is_quiz_room = 1 WHERE id = 2`);
        }
    });

    // إضافة أسئلة المسابقات الافتراضية
    const defaultQuestions = [
        {
            question: "ما هي عاصمة المملكة العربية السعودية؟",
            a: "جدة", b: "الرياض", c: "الدمام", d: "مكة المكرمة",
            correct: "b"
        },
        {
            question: "كم عدد أيام السنة الهجرية؟",
            a: "354", b: "365", c: "355", d: "360",
            correct: "a"
        },
        {
            question: "من هو مؤسس المملكة العربية السعودية؟",
            a: "الملك فهد", b: "الملك عبدالله", c: "الملك عبدالعزيز", d: "الملك سلمان",
            correct: "c"
        },
        {
            question: "ما هي أكبر قارة في العالم؟",
            a: "أفريقيا", b: "آسيا", c: "أوروبا", d: "أمريكا الشمالية",
            correct: "b"
        },
        {
            question: "كم عدد أركان الإسلام؟",
            a: "4", b: "5", c: "6", d: "7",
            correct: "b"
        },
        {
            question: "ما هو أطول نهر في العالم؟",
            a: "النيل", b: "الأمازون", c: "دجلة", d: "الفرات",
            correct: "a"
        },
        {
            question: "في أي عام تم اكتشاف النفط في المملكة العربية السعودية؟",
            a: "1935", b: "1938", c: "1940", d: "1945",
            correct: "b"
        },
        {
            question: "ما هي العملة الرسمية للمملكة العربية السعودية؟",
            a: "الدرهم", b: "الدينار", c: "الريال", d: "الجنيه",
            correct: "c"
        },
        {
            question: "كم عدد الصلوات المفروضة في اليوم؟",
            a: "3", b: "4", c: "5", d: "6",
            correct: "c"
        },
        {
            question: "ما هي أصغر دولة في العالم؟",
            a: "موناكو", b: "الفاتيكان", c: "سان مارينو", d: "ليختنشتاين",
            correct: "b"
        }
    ];

    defaultQuestions.forEach(q => {
        db.run(`
            INSERT OR IGNORE INTO quiz_questions 
            (question, option_a, option_b, option_c, option_d, correct_answer) 
            VALUES (?, ?, ?, ?, ?, ?)
        `, [q.question, q.a, q.b, q.c, q.d, q.correct]);
    });
});

// متغيرات عامة
const connectedUsers = new Map();
const activeQuizzes = new Map(); // roomId -> quiz data
const userFloodProtection = new Map(); // userId -> message timestamps

// وسائل المساعدة
function generateToken(user) {
    return jwt.sign(
        { id: user.id, email: user.email, rank: user.rank },
        JWT_SECRET,
        { expiresIn: '7d' }
    );
}

function verifyToken(token) {
    try {
        return jwt.verify(token, JWT_SECRET);
    } catch (error) {
        return null;
    }
}

// فحص الحماية من الفيضانات
function checkFloodProtection(userId) {
    const now = Date.now();
    const userActivity = userFloodProtection.get(userId) || [];
    
    // إزالة الأنشطة القديمة (أكثر من دقيقة)
    const recentActivity = userActivity.filter(timestamp => now - timestamp < 60000);
    
    // إذا كان هناك أكثر من 5 رسائل في الدقيقة الواحدة
    if (recentActivity.length >= 5) {
        return {
            isFlooding: true,
            muteUntil: now + (5 * 60 * 1000) // كتم لمدة 5 دقائق
        };
    }
    
    // تحديث النشاط
    recentActivity.push(now);
    userFloodProtection.set(userId, recentActivity);
    
    return { isFlooding: false };
}

// وسائل وسيطة للمصادقة
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }

    const decoded = verifyToken(token);
    if (!decoded) {
        return res.status(403).json({ error: 'Invalid token' });
    }

    req.user = decoded;
    next();
}

// التحقق من حالة الحظر
function checkBanStatus(req, res, next) {
    db.get('SELECT is_banned, ban_reason FROM users WHERE id = ?', [req.user.id], (err, user) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        
        if (user && user.is_banned) {
            return res.status(403).json({ 
                error: 'تم حظرك من الشات: ' + (user.ban_reason || 'لم يتم تحديد السبب'),
                banReason: user.ban_reason 
            });
        }
        
        next();
    });
}

// نقاط النهاية للمصادقة
app.post('/api/register', async (req, res) => {
    const { email, password, displayName } = req.body;

    if (!email || !password || !displayName) {
        return res.status(400).json({ error: 'جميع الحقول مطلوبة' });
    }

    if (password.length < 6) {
        return res.status(400).json({ error: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        
        db.run(
            'INSERT INTO users (email, display_name, password_hash) VALUES (?, ?, ?)',
            [email, displayName, hashedPassword],
            function(err) {
                if (err) {
                    if (err.message.includes('UNIQUE constraint failed')) {
                        return res.status(400).json({ error: 'البريد الإلكتروني مسجل مسبقاً' });
                    }
                    return res.status(500).json({ error: 'حدث خطأ في التسجيل' });
                }

                const userId = this.lastID;
                db.get('SELECT * FROM users WHERE id = ?', [userId], (err, user) => {
                    if (err) {
                        return res.status(500).json({ error: 'حدث خطأ في قاعدة البيانات' });
                    }

                    const token = generateToken(user);
                    res.json({ 
                        token, 
                        user: {
                            id: user.id,
                            email: user.email,
                            display_name: user.display_name,
                            rank: user.rank,
                            points: user.points,
                            profile_image: user.profile_image,
                            background_image: user.background_image,
                            status_message: user.status_message,
                            audio_settings: JSON.parse(user.audio_settings || '{}'),
                            theme_settings: JSON.parse(user.theme_settings || '{}')
                        }
                    });
                });
            }
        );
    } catch (error) {
        res.status(500).json({ error: 'حدث خطأ في التسجيل' });
    }
});

app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: 'جميع الحقول مطلوبة' });
    }

    db.get('SELECT * FROM users WHERE email = ?', [email], async (err, user) => {
        if (err) {
            return res.status(500).json({ error: 'حدث خطأ في قاعدة البيانات' });
        }

        if (!user) {
            return res.status(400).json({ error: 'البريد الإلكتروني أو كلمة المرور غير صحيحة' });
        }

        if (user.is_banned) {
            return res.status(403).json({ 
                error: 'تم حظرك من الشات محظور',
                banReason: user.ban_reason || 'لم يتم تحديد السبب'
            });
        }

        const validPassword = await bcrypt.compare(password, user.password_hash);
        if (!validPassword) {
            return res.status(400).json({ error: 'البريد الإلكتروني أو كلمة المرور غير صحيحة' });
        }

        // تحديث آخر نشاط
        db.run('UPDATE users SET last_active = CURRENT_TIMESTAMP WHERE id = ?', [user.id]);

        const token = generateToken(user);
        res.json({ 
            token, 
            user: {
                id: user.id,
                email: user.email,
                display_name: user.display_name,
                rank: user.rank,
                points: user.points,
                profile_image: user.profile_image,
                background_image: user.background_image,
                status_message: user.status_message,
                audio_settings: JSON.parse(user.audio_settings || '{}'),
                theme_settings: JSON.parse(user.theme_settings || '{}')
            }
        });
    });
});

app.post('/api/guest-login', (req, res) => {
    const { displayName } = req.body;

    if (!displayName) {
        return res.status(400).json({ error: 'الاسم المعروض مطلوب' });
    }

    const guestId = 'guest_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    
    db.run(
        'INSERT INTO users (display_name, is_guest, guest_id) VALUES (?, 1, ?)',
        [displayName, guestId],
        function(err) {
            if (err) {
                return res.status(500).json({ error: 'حدث خطأ في تسجيل الدخول كزائر' });
            }

            const userId = this.lastID;
            db.get('SELECT * FROM users WHERE id = ?', [userId], (err, user) => {
                if (err) {
                    return res.status(500).json({ error: 'حدث خطأ في قاعدة البيانات' });
                }

                const token = generateToken(user);
                res.json({ 
                    token, 
                    user: {
                        id: user.id,
                        email: user.email,
                        display_name: user.display_name,
                        rank: user.rank,
                        points: user.points,
                        profile_image: user.profile_image,
                        background_image: user.background_image,
                        status_message: user.status_message,
                        is_guest: true,
                        guest_id: user.guest_id,
                        audio_settings: JSON.parse(user.audio_settings || '{}'),
                        theme_settings: JSON.parse(user.theme_settings || '{}')
                    }
                });
            });
        }
    );
});

// نقاط نهاية المستخدم
app.get('/api/user/profile', authenticateToken, checkBanStatus, (req, res) => {
    db.get('SELECT * FROM users WHERE id = ?', [req.user.id], (err, user) => {
        if (err) {
            return res.status(500).json({ error: 'حدث خطأ في قاعدة البيانات' });
        }

        if (!user) {
            return res.status(404).json({ error: 'المستخدم غير موجود' });
        }

        res.json({
            id: user.id,
            email: user.email,
            display_name: user.display_name,
            rank: user.rank,
            points: user.points,
            profile_image: user.profile_image,
            background_image: user.background_image,
            status_message: user.status_message,
            is_guest: user.is_guest,
            guest_id: user.guest_id,
            join_date: user.join_date,
            audio_settings: JSON.parse(user.audio_settings || '{}'),
            theme_settings: JSON.parse(user.theme_settings || '{}')
        });
    });
});

// نقاط نهاية الغرف
app.get('/api/rooms', authenticateToken, checkBanStatus, (req, res) => {
    db.all('SELECT * FROM rooms ORDER BY id', (err, rooms) => {
        if (err) {
            return res.status(500).json({ error: 'حدث خطأ في قاعدة البيانات' });
        }
        res.json(rooms);
    });
});

// نقاط نهاية الرسائل
app.get('/api/messages/:roomId', authenticateToken, checkBanStatus, (req, res) => {
    const roomId = parseInt(req.params.roomId);
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;

    db.all(`
        SELECT m.*, u.display_name, u.profile_image, u.rank
        FROM messages m
        LEFT JOIN users u ON m.user_id = u.id
        WHERE m.room_id = ? AND m.is_deleted = 0
        ORDER BY m.timestamp DESC
        LIMIT ? OFFSET ?
    `, [roomId, limit, offset], (err, messages) => {
        if (err) {
            return res.status(500).json({ error: 'حدث خطأ في قاعدة البيانات' });
        }
        res.json(messages.reverse());
    });
});

// نقاط نهاية القصص/الأخبار
app.get('/api/stories', authenticateToken, checkBanStatus, (req, res) => {
    const limit = parseInt(req.query.limit) || 20;
    const offset = parseInt(req.query.offset) || 0;

    db.all(`
        SELECT s.*, u.display_name, u.profile_image, u.rank,
               (SELECT COUNT(*) FROM story_reactions WHERE story_id = s.id AND reaction_type = 'like') as likes,
               (SELECT COUNT(*) FROM story_reactions WHERE story_id = s.id AND reaction_type = 'dislike') as dislikes,
               (SELECT COUNT(*) FROM story_reactions WHERE story_id = s.id AND reaction_type = 'love') as loves,
               (SELECT COUNT(*) FROM story_comments WHERE story_id = s.id) as comment_count
        FROM stories s
        LEFT JOIN users u ON s.user_id = u.id
        ORDER BY s.timestamp DESC
        LIMIT ? OFFSET ?
    `, [limit, offset], (err, stories) => {
        if (err) {
            return res.status(500).json({ error: 'حدث خطأ في قاعدة البيانات' });
        }
        res.json(stories);
    });
});

app.post('/api/stories', authenticateToken, checkBanStatus, upload.single('image'), (req, res) => {
    const { content } = req.body;
    const imageUrl = req.file ? `/uploads/${req.file.filename}` : null;

    if (!content) {
        return res.status(400).json({ error: 'المحتوى مطلوب' });
    }

    db.run(`
        INSERT INTO stories (user_id, content, image_url)
        VALUES (?, ?, ?)
    `, [req.user.id, content, imageUrl], function(err) {
        if (err) {
            return res.status(500).json({ error: 'حدث خطأ في نشر القصة' });
        }

        const storyId = this.lastID;
        
        // جلب القصة مع بيانات المستخدم
        db.get(`
            SELECT s.*, u.display_name, u.profile_image, u.rank
            FROM stories s
            LEFT JOIN users u ON s.user_id = u.id
            WHERE s.id = ?
        `, [storyId], (err, story) => {
            if (err) {
                return res.status(500).json({ error: 'حدث خطأ في قاعدة البيانات' });
            }

            // إرسال القصة الجديدة لجميع المستخدمين المتصلين
            io.emit('newStory', {
                ...story,
                likes: 0,
                dislikes: 0,
                loves: 0,
                comment_count: 0
            });

            res.json({ 
                message: 'تم نشر القصة بنجاح',
                story: story 
            });
        });
    });
});

app.post('/api/stories/:storyId/react', authenticateToken, checkBanStatus, (req, res) => {
    const storyId = parseInt(req.params.storyId);
    const { reactionType } = req.body; // 'like', 'dislike', 'love'

    if (!['like', 'dislike', 'love'].includes(reactionType)) {
        return res.status(400).json({ error: 'نوع التفاعل غير صحيح' });
    }

    // حذف التفاعل السابق إن وجد
    db.run('DELETE FROM story_reactions WHERE story_id = ? AND user_id = ?', [storyId, req.user.id], (err) => {
        if (err) {
            return res.status(500).json({ error: 'حدث خطأ في قاعدة البيانات' });
        }

        // إضافة التفاعل الجديد
        db.run(`
            INSERT INTO story_reactions (story_id, user_id, reaction_type)
            VALUES (?, ?, ?)
        `, [storyId, req.user.id, reactionType], (err) => {
            if (err) {
                return res.status(500).json({ error: 'حدث خطأ في إضافة التفاعل' });
            }

            // جلب عدد التفاعلات المحدث
            db.all(`
                SELECT reaction_type, COUNT(*) as count
                FROM story_reactions
                WHERE story_id = ?
                GROUP BY reaction_type
            `, [storyId], (err, reactions) => {
                if (err) {
                    return res.status(500).json({ error: 'حدث خطأ في قاعدة البيانات' });
                }

                const reactionCounts = {
                    likes: 0,
                    dislikes: 0,
                    loves: 0
                };

                reactions.forEach(r => {
                    if (r.reaction_type === 'like') reactionCounts.likes = r.count;
                    else if (r.reaction_type === 'dislike') reactionCounts.dislikes = r.count;
                    else if (r.reaction_type === 'love') reactionCounts.loves = r.count;
                });

                // إرسال تحديث التفاعلات لجميع المستخدمين
                io.emit('storyReactionUpdate', {
                    storyId,
                    reactions: reactionCounts
                });

                res.json({ 
                    message: 'تم إضافة التفاعل بنجاح',
                    reactions: reactionCounts
                });
            });
        });
    });
});

app.get('/api/stories/:storyId/comments', authenticateToken, checkBanStatus, (req, res) => {
    const storyId = parseInt(req.params.storyId);

    db.all(`
        SELECT sc.*, u.display_name, u.profile_image, u.rank
        FROM story_comments sc
        LEFT JOIN users u ON sc.user_id = u.id
        WHERE sc.story_id = ?
        ORDER BY sc.timestamp ASC
    `, [storyId], (err, comments) => {
        if (err) {
            return res.status(500).json({ error: 'حدث خطأ في قاعدة البيانات' });
        }
        res.json(comments);
    });
});

app.post('/api/stories/:storyId/comments', authenticateToken, checkBanStatus, (req, res) => {
    const storyId = parseInt(req.params.storyId);
    const { comment } = req.body;

    if (!comment || comment.trim().length === 0) {
        return res.status(400).json({ error: 'التعليق مطلوب' });
    }

    db.run(`
        INSERT INTO story_comments (story_id, user_id, comment)
        VALUES (?, ?, ?)
    `, [storyId, req.user.id, comment.trim()], function(err) {
        if (err) {
            return res.status(500).json({ error: 'حدث خطأ في إضافة التعليق' });
        }

        const commentId = this.lastID;

        // جلب التعليق مع بيانات المستخدم
        db.get(`
            SELECT sc.*, u.display_name, u.profile_image, u.rank
            FROM story_comments sc
            LEFT JOIN users u ON sc.user_id = u.id
            WHERE sc.id = ?
        `, [commentId], (err, newComment) => {
            if (err) {
                return res.status(500).json({ error: 'حدث خطأ في قاعدة البيانات' });
            }

            // إرسال التعليق الجديد لجميع المستخدمين
            io.emit('newStoryComment', {
                storyId,
                comment: newComment
            });

            res.json({ 
                message: 'تم إضافة التعليق بنجاح',
                comment: newComment
            });
        });
    });
});

// وسائل وسيطة للتحقق من الصلاحيات الإدارية
function checkAdminPermission(req, res, next) {
    // الرتبة 4 فما فوق هي رتب إدارية (trophy = 4, diamond = 5, prince = 6, admin = 7)
    if (req.user.rank >= 4) {
        next();
    } else {
        return res.status(403).json({ error: 'ليس لديك صلاحيات إدارية' });
    }
}

function checkOwnerPermission(req, res, next) {
    // مالك الموقع (trophy = 4) أو أعلى
    if (req.user.rank >= 4) {
        next();
    } else {
        return res.status(403).json({ error: 'هذه العملية مخصصة لمالك الموقع والإدارة العليا فقط' });
    }
}

// نقاط نهاية التحكم الإداري

// حظر مستخدم
app.post('/api/admin/ban-user', authenticateToken, checkBanStatus, checkAdminPermission, (req, res) => {
    const { userId, banReason } = req.body;

    if (!userId) {
        return res.status(400).json({ error: 'معرف المستخدم مطلوب' });
    }

    db.run(`
        UPDATE users SET is_banned = 1, ban_reason = ? WHERE id = ?
    `, [banReason || 'تم حظرك من قبل الإدارة', userId], function(err) {
        if (err) {
            return res.status(500).json({ error: 'حدث خطأ في حظر المستخدم' });
        }

        if (this.changes === 0) {
            return res.status(404).json({ error: 'المستخدم غير موجود' });
        }

        // فصل المستخدم إذا كان متصلاً
        const userConnection = connectedUsers.get(userId);
        if (userConnection) {
            io.to(userConnection.socketId).emit('banned', { reason: banReason });
            // إزالة المستخدم من قائمة المتصلين
            connectedUsers.delete(userId);
        }

        res.json({ message: 'تم حظر المستخدم بنجاح' });
    });
});

// إلغاء حظر مستخدم
app.post('/api/admin/unban-user', authenticateToken, checkBanStatus, checkAdminPermission, (req, res) => {
    const { userId } = req.body;

    if (!userId) {
        return res.status(400).json({ error: 'معرف المستخدم مطلوب' });
    }

    db.run(`
        UPDATE users SET is_banned = 0, ban_reason = NULL WHERE id = ?
    `, [userId], function(err) {
        if (err) {
            return res.status(500).json({ error: 'حدث خطأ في إلغاء حظر المستخدم' });
        }

        if (this.changes === 0) {
            return res.status(404).json({ error: 'المستخدم غير موجود' });
        }

        res.json({ message: 'تم إلغاء حظر المستخدم بنجاح' });
    });
});

// كتم مستخدم
app.post('/api/admin/mute-user', authenticateToken, checkBanStatus, checkAdminPermission, (req, res) => {
    const { userId, muteDuration } = req.body; // مدة الكتم بالدقائق

    if (!userId) {
        return res.status(400).json({ error: 'معرف المستخدم مطلوب' });
    }

    const muteUntil = new Date(Date.now() + (muteDuration || 60) * 60 * 1000).toISOString();

    db.run(`
        UPDATE users SET is_muted = 1, mute_until = ? WHERE id = ?
    `, [muteUntil, userId], function(err) {
        if (err) {
            return res.status(500).json({ error: 'حدث خطأ في كتم المستخدم' });
        }

        if (this.changes === 0) {
            return res.status(404).json({ error: 'المستخدم غير موجود' });
        }

        res.json({ message: 'تم كتم المستخدم بنجاح' });
    });
});

// إلغاء كتم مستخدم
app.post('/api/admin/unmute-user', authenticateToken, checkBanStatus, checkAdminPermission, (req, res) => {
    const { userId } = req.body;

    if (!userId) {
        return res.status(400).json({ error: 'معرف المستخدم مطلوب' });
    }

    db.run(`
        UPDATE users SET is_muted = 0, mute_until = NULL WHERE id = ?
    `, [userId], function(err) {
        if (err) {
            return res.status(500).json({ error: 'حدث خطأ في إلغاء كتم المستخدم' });
        }

        if (this.changes === 0) {
            return res.status(404).json({ error: 'المستخدم غير موجود' });
        }

        res.json({ message: 'تم إلغاء كتم المستخدم بنجاح' });
    });
});

// منح نقاط للمستخدم
app.post('/api/admin/give-points', authenticateToken, checkBanStatus, checkOwnerPermission, (req, res) => {
    const { userId, points } = req.body;

    if (!userId || typeof points !== 'number') {
        return res.status(400).json({ error: 'معرف المستخدم والنقاط مطلوبة' });
    }

    db.run(`
        UPDATE users SET points = points + ? WHERE id = ?
    `, [points, userId], function(err) {
        if (err) {
            return res.status(500).json({ error: 'حدث خطأ في منح النقاط' });
        }

        if (this.changes === 0) {
            return res.status(404).json({ error: 'المستخدم غير موجود' });
        }

        // إرسال إشعار للمستخدم
        const message = points > 0 ? 
            `تم منحك ${points} نقطة من قبل الإدارة!` : 
            `تم خصم ${Math.abs(points)} نقطة من رصيدك`;

        db.run(`
            INSERT INTO notifications (user_id, title, message, type)
            VALUES (?, ?, ?, ?)
        `, [userId, 'تحديث النقاط', message, 'points'], (err) => {
            // إرسال إشعار فوري إذا كان المستخدم متصل
            const userConnection = connectedUsers.get(userId);
            if (userConnection) {
                io.to(userConnection.socketId).emit('newNotification', {
                    title: 'تحديث النقاط',
                    message: message,
                    type: 'points'
                });
            }
        });

        res.json({ message: 'تم منح النقاط بنجاح' });
    });
});

// إرسال إشعار مخصص
app.post('/api/admin/send-notification', authenticateToken, checkBanStatus, checkOwnerPermission, (req, res) => {
    const { userId, title, message, type } = req.body;

    if (!userId || !title || !message) {
        return res.status(400).json({ error: 'جميع البيانات مطلوبة' });
    }

    db.run(`
        INSERT INTO notifications (user_id, title, message, type)
        VALUES (?, ?, ?, ?)
    `, [userId, title, message, type || 'info'], function(err) {
        if (err) {
            return res.status(500).json({ error: 'حدث خطأ في إرسال الإشعار' });
        }

        // إرسال إشعار فوري إذا كان المستخدم متصل
        const userConnection = connectedUsers.get(userId);
        if (userConnection) {
            io.to(userConnection.socketId).emit('newNotification', {
                title,
                message,
                type: type || 'info'
            });
        }

        res.json({ message: 'تم إرسال الإشعار بنجاح' });
    });
});

// إرسال إشعار جماعي
app.post('/api/admin/broadcast-notification', authenticateToken, checkBanStatus, checkOwnerPermission, (req, res) => {
    const { title, message, type } = req.body;

    if (!title || !message) {
        return res.status(400).json({ error: 'العنوان والرسالة مطلوبان' });
    }

    // جلب جميع المستخدمين غير المحظورين
    db.all('SELECT id FROM users WHERE is_banned = 0', (err, users) => {
        if (err) {
            return res.status(500).json({ error: 'حدث خطأ في قاعدة البيانات' });
        }

        const notifications = users.map(user => [user.id, title, message, type || 'info']);
        
        // إدراج الإشعارات في قاعدة البيانات
        const placeholders = users.map(() => '(?, ?, ?, ?)').join(',');
        const flatValues = notifications.flat();

        db.run(`
            INSERT INTO notifications (user_id, title, message, type)
            VALUES ${placeholders}
        `, flatValues, (err) => {
            if (err) {
                return res.status(500).json({ error: 'حدث خطأ في حفظ الإشعارات' });
            }

            // إرسال إشعار فوري لجميع المستخدمين المتصلين
            io.emit('newNotification', {
                title,
                message,
                type: type || 'info'
            });

            res.json({ 
                message: `تم إرسال الإشعار لـ ${users.length} مستخدم بنجاح` 
            });
        });
    });
});

// إنشاء غرفة جديدة
app.post('/api/admin/create-room', authenticateToken, checkBanStatus, checkOwnerPermission, (req, res) => {
    const { name, description, isQuizRoom } = req.body;

    if (!name) {
        return res.status(400).json({ error: 'اسم الغرفة مطلوب' });
    }

    db.run(`
        INSERT INTO rooms (name, description, creator_id, is_quiz_room)
        VALUES (?, ?, ?, ?)
    `, [name, description || '', req.user.id, isQuizRoom ? 1 : 0], function(err) {
        if (err) {
            return res.status(500).json({ error: 'حدث خطأ في إنشاء الغرفة' });
        }

        const roomId = this.lastID;

        // إرسال تحديث الغرف لجميع المستخدمين
        io.emit('roomCreated', {
            id: roomId,
            name,
            description,
            creator_id: req.user.id,
            is_quiz_room: isQuizRoom ? 1 : 0
        });

        res.json({ 
            message: 'تم إنشاء الغرفة بنجاح',
            roomId: roomId 
        });
    });
});

// حذف غرفة
app.delete('/api/admin/delete-room/:roomId', authenticateToken, checkBanStatus, checkOwnerPermission, (req, res) => {
    const roomId = parseInt(req.params.roomId);

    // منع حذف الغرف الافتراضية
    if (roomId <= 2) {
        return res.status(400).json({ error: 'لا يمكن حذف الغرف الافتراضية' });
    }

    db.run('DELETE FROM rooms WHERE id = ?', [roomId], function(err) {
        if (err) {
            return res.status(500).json({ error: 'حدث خطأ في حذف الغرفة' });
        }

        if (this.changes === 0) {
            return res.status(404).json({ error: 'الغرفة غير موجودة' });
        }

        // إرسال تحديث حذف الغرفة لجميع المستخدمين
        io.emit('roomDeleted', { roomId });

        res.json({ message: 'تم حذف الغرفة بنجاح' });
    });
});

// جلب قائمة المستخدمين للإدارة
app.get('/api/admin/users', authenticateToken, checkBanStatus, checkAdminPermission, (req, res) => {
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;

    db.all(`
        SELECT id, email, display_name, rank, points, is_banned, ban_reason, 
               is_muted, mute_until, last_active, join_date, is_guest
        FROM users
        ORDER BY join_date DESC
        LIMIT ? OFFSET ?
    `, [limit, offset], (err, users) => {
        if (err) {
            return res.status(500).json({ error: 'حدث خطأ في قاعدة البيانات' });
        }
        res.json(users);
    });
});

// تحديث رتبة مستخدم
app.post('/api/admin/update-user-rank', authenticateToken, checkBanStatus, checkOwnerPermission, (req, res) => {
    const { userId, newRank } = req.body;

    if (!userId || typeof newRank !== 'number' || newRank < 0 || newRank > 7) {
        return res.status(400).json({ error: 'معرف المستخدم والرتبة الجديدة مطلوبان' });
    }

    // منع تحديث رتبة المالك
    if (userId === 1) {
        return res.status(403).json({ error: 'لا يمكن تعديل رتبة مالك الموقع' });
    }

    db.run(`
        UPDATE users SET rank = ? WHERE id = ?
    `, [newRank, userId], function(err) {
        if (err) {
            return res.status(500).json({ error: 'حدث خطأ في تحديث الرتبة' });
        }

        if (this.changes === 0) {
            return res.status(404).json({ error: 'المستخدم غير موجود' });
        }

        // إرسال إشعار للمستخدم
        const rankNames = ['زائر', 'برونزي', 'فضي', 'ذهبي', 'مالك الموقع', 'الماس', 'برنس', 'إداري'];
        const message = `تم تحديث رتبتك إلى ${rankNames[newRank]}!`;

        db.run(`
            INSERT INTO notifications (user_id, title, message, type)
            VALUES (?, ?, ?, ?)
        `, [userId, 'تحديث الرتبة', message, 'rank'], (err) => {
            // إرسال إشعار فوري إذا كان المستخدم متصل
            const userConnection = connectedUsers.get(userId);
            if (userConnection) {
                userConnection.rank = newRank; // تحديث الرتبة في الذاكرة
                io.to(userConnection.socketId).emit('newNotification', {
                    title: 'تحديث الرتبة',
                    message: message,
                    type: 'rank'
                });
            }
        });

        res.json({ message: 'تم تحديث الرتبة بنجاح' });
    });
});

// نقاط نهاية الرتب والمميزات

// رفع موسيقى (للرتبة 2 فما فوق)
app.post('/api/upload-music', authenticateToken, checkBanStatus, upload.single('music'), (req, res) => {
    if (req.user.rank < 2) {
        return res.status(403).json({ error: 'هذه الميزة متاحة للرتبة 2 فما فوق' });
    }

    if (!req.file) {
        return res.status(400).json({ error: 'يرجى اختيار ملف صوتي' });
    }

    const musicUrl = `/uploads/${req.file.filename}`;
    
    // تحديث رابط الموسيقى للمستخدم
    db.run(`
        UPDATE users SET profile_music = ? WHERE id = ?
    `, [musicUrl, req.user.id], function(err) {
        if (err) {
            return res.status(500).json({ error: 'حدث خطأ في رفع الموسيقى' });
        }

        res.json({ 
            message: 'تم رفع الموسيقى بنجاح',
            musicUrl: musicUrl 
        });
    });
});

// رفع خلفية (للرتبة 2 فما فوق)
app.post('/api/upload-background', authenticateToken, checkBanStatus, upload.single('background'), (req, res) => {
    if (req.user.rank < 2) {
        return res.status(403).json({ error: 'هذه الميزة متاحة للرتبة 2 فما فوق' });
    }

    if (!req.file) {
        return res.status(400).json({ error: 'يرجى اختيار صورة خلفية' });
    }

    const backgroundUrl = `/uploads/${req.file.filename}`;
    
    // تحديث رابط الخلفية للمستخدم
    db.run(`
        UPDATE users SET message_background = ? WHERE id = ?
    `, [backgroundUrl, req.user.id], function(err) {
        if (err) {
            return res.status(500).json({ error: 'حدث خطأ في رفع الخلفية' });
        }

        res.json({ 
            message: 'تم رفع الخلفية بنجاح',
            backgroundUrl: backgroundUrl 
        });
    });
});

// جلب موسيقى وخلفيات المستخدم
app.get('/api/user/media', authenticateToken, checkBanStatus, (req, res) => {
    db.get('SELECT profile_music, message_background FROM users WHERE id = ?', [req.user.id], (err, user) => {
        if (err) {
            return res.status(500).json({ error: 'حدث خطأ في قاعدة البيانات' });
        }

        res.json({
            music: user?.profile_music,
            background: user?.message_background
        });
    });
});

// حذف موسيقى المستخدم
app.delete('/api/user/music', authenticateToken, checkBanStatus, (req, res) => {
    if (req.user.rank < 2) {
        return res.status(403).json({ error: 'هذه الميزة متاحة للرتبة 2 فما فوق' });
    }

    db.run(`UPDATE users SET profile_music = NULL WHERE id = ?`, [req.user.id], function(err) {
        if (err) {
            return res.status(500).json({ error: 'حدث خطأ في حذف الموسيقى' });
        }
        res.json({ message: 'تم حذف الموسيقى بنجاح' });
    });
});

// حذف خلفية المستخدم
app.delete('/api/user/background', authenticateToken, checkBanStatus, (req, res) => {
    if (req.user.rank < 2) {
        return res.status(403).json({ error: 'هذه الميزة متاحة للرتبة 2 فما فوق' });
    }

    db.run(`UPDATE users SET message_background = NULL WHERE id = ?`, [req.user.id], function(err) {
        if (err) {
            return res.status(500).json({ error: 'حدث خطأ في حذف الخلفية' });
        }
        res.json({ message: 'تم حذف الخلفية بنجاح' });
    });
});

// تشغيل الخادم
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🦂 خادم شات وتين العقرب يعمل على المنفذ ${PORT}`);
});

// معالجة Socket.IO
io.use(async (socket, next) => {
    const token = socket.handshake.auth.token;
    const decoded = verifyToken(token);
    if (!decoded) {
        return next(new Error('Authentication error'));
    }

    // فحص حالة الحظر والكتم
    db.get('SELECT is_banned, ban_reason, is_muted, mute_until FROM users WHERE id = ?', [decoded.id], (err, user) => {
        if (err) {
            return next(new Error('Database error'));
        }
        
        if (!user) {
            return next(new Error('User not found'));
        }
        
        if (user.is_banned) {
            return next(new Error('User is banned: ' + (user.ban_reason || 'No reason provided')));
        }
        
        socket.userId = decoded.id;
        socket.userRank = decoded.rank;
        socket.userData = user;
        next();
    });
});

io.on('connection', (socket) => {
    console.log(`مستخدم متصل: ${socket.userId}`);
    
    // إضافة المستخدم للقائمة المتصلين
    connectedUsers.set(socket.userId, {
        socketId: socket.id,
        userId: socket.userId,
        rank: socket.userRank
    });

    // الانضمام لغرفة
    socket.on('join', (data) => {
        // مغادرة الغرفة السابقة إذا كانت موجودة
        if (socket.currentRoom) {
            socket.leave(socket.currentRoom);
        }
        
        socket.join(data.roomId);
        socket.currentRoom = data.roomId;
        
        // تحديث بيانات المستخدم المتصل
        connectedUsers.set(socket.userId, {
            socketId: socket.id,
            userId: socket.userId,
            rank: socket.userRank,
            displayName: data.displayName,
            currentRoom: data.roomId
        });
        
        // تحديث آخر نشاط
        db.run('UPDATE users SET last_active = CURRENT_TIMESTAMP WHERE id = ?', [socket.userId]);
        
        // إرسال قائمة المستخدمين المتصلين في هذه الغرفة فقط
        const roomUsers = Array.from(connectedUsers.values()).filter(user => user.currentRoom === data.roomId);
        io.to(data.roomId).emit('onlineUsersUpdated', roomUsers);
    });

    // إرسال رسالة
    socket.on('sendMessage', async (data) => {
        // فحص الحماية من الفيضانات
        const floodCheck = checkFloodProtection(socket.userId);
        if (floodCheck.isFlooding) {
            // كتم المستخدم
            db.run(
                'UPDATE users SET is_muted = 1, mute_until = ? WHERE id = ?',
                [new Date(floodCheck.muteUntil).toISOString(), socket.userId]
            );
            
            // إشعار بالكتم
            const muteMessage = {
                id: 'mute_' + Date.now(),
                message: `تم كتم المستخدم بسبب الفيضانات لمدة 5 دقائق`,
                timestamp: new Date().toISOString(),
                isSystemMessage: true,
                type: 'mute'
            };
            
            io.to(data.roomId).emit('newMessage', muteMessage);
            socket.emit('error', 'تم كتمك لمدة 5 دقائق بسبب الإرسال السريع');
            return;
        }

        // فحص حالة الكتم
        db.get('SELECT is_muted, mute_until FROM users WHERE id = ?', [socket.userId], (err, user) => {
            if (user && user.is_muted) {
                const muteUntil = new Date(user.mute_until);
                if (muteUntil > new Date()) {
                    socket.emit('error', 'أنت مكتوم حالياً');
                    return;
                } else {
                    // إلغاء الكتم إذا انتهت المدة
                    db.run('UPDATE users SET is_muted = 0, mute_until = NULL WHERE id = ?', [socket.userId]);
                }
            }

            // حفظ الرسالة في قاعدة البيانات
            db.run(`
                INSERT INTO messages (user_id, room_id, message, quoted_message_id, quoted_author, quoted_content)
                VALUES (?, ?, ?, ?, ?, ?)
            `, [socket.userId, data.roomId, data.message, data.quoted_message_id, data.quoted_author, data.quoted_content], function(err) {
                if (err) {
                    socket.emit('error', 'حدث خطأ في إرسال الرسالة');
                    return;
                }

                const messageId = this.lastID;
                
                // جلب بيانات المستخدم وإرسال الرسالة
                db.get('SELECT display_name, profile_image, rank FROM users WHERE id = ?', [socket.userId], (err, user) => {
                    if (err || !user) return;

                    const messageData = {
                        id: messageId,
                        user_id: socket.userId,
                        room_id: data.roomId,
                        message: data.message,
                        display_name: user.display_name,
                        profile_image: user.profile_image,
                        rank: user.rank,
                        timestamp: new Date().toISOString(),
                        quoted_message_id: data.quoted_message_id,
                        quoted_author: data.quoted_author,
                        quoted_content: data.quoted_content
                    };

                    io.to(data.roomId).emit('newMessage', messageData);
                });
            });
        });
    });

    // رسالة خاصة
    socket.on('sendPrivateMessage', (data) => {
        // فحص الحماية من الفيضانات للرسائل الخاصة
        const floodCheck = checkFloodProtection(socket.userId);
        if (floodCheck.isFlooding) {
            socket.emit('error', 'تم كتمك لمدة 5 دقائق بسبب الإرسال السريع');
            return;
        }

        db.run(`
            INSERT INTO private_messages (sender_id, receiver_id, message)
            VALUES (?, ?, ?)
        `, [socket.userId, data.receiverId, data.message], function(err) {
            if (err) {
                socket.emit('error', 'حدث خطأ في إرسال الرسالة الخاصة');
                return;
            }

            const messageId = this.lastID;
            
            // جلب بيانات المرسل
            db.get('SELECT display_name, profile_image FROM users WHERE id = ?', [socket.userId], (err, sender) => {
                if (err || !sender) return;

                const messageData = {
                    id: messageId,
                    sender_id: socket.userId,
                    receiver_id: data.receiverId,
                    message: data.message,
                    sender_name: sender.display_name,
                    sender_image: sender.profile_image,
                    timestamp: new Date().toISOString()
                };

                // إرسال للمرسل والمستقبل
                socket.emit('newPrivateMessage', messageData);
                
                const receiverConnection = connectedUsers.get(data.receiverId);
                if (receiverConnection) {
                    socket.to(receiverConnection.socketId).emit('newPrivateMessage', messageData);
                }
            });
        });
    });

    // قطع الاتصال
    socket.on('disconnect', () => {
        console.log(`مستخدم انقطع: ${socket.userId}`);
        
        const disconnectedUser = connectedUsers.get(socket.userId);
        connectedUsers.delete(socket.userId);
        
        // تحديث قائمة المستخدمين المتصلين في الغرفة التي كان فيها
        if (socket.currentRoom) {
            const roomUsers = Array.from(connectedUsers.values()).filter(user => user.currentRoom === socket.currentRoom);
            io.to(socket.currentRoom).emit('onlineUsersUpdated', roomUsers);
        }
    });
});
