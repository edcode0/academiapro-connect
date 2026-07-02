require('dotenv').config();

// ─── Sentry error tracking (must be first) ───────────────────────────────────
const Sentry = require('@sentry/node');
if (process.env.SENTRY_DSN) {
    Sentry.init({
        dsn: process.env.SENTRY_DSN,
        environment: process.env.NODE_ENV || 'production',
        tracesSampleRate: 0.1
    });
    console.log('[Sentry] Initialized for environment:', process.env.NODE_ENV || 'production');
} else {
    console.log('[Sentry] SENTRY_DSN not set — error tracking disabled');
}
// ─────────────────────────────────────────────────────────────────────────────

console.log('=== DB CHECK ===');
console.log('Database configured:', !!process.env.DATABASE_URL);

process.on('uncaughtException', (err) => {
    console.error('UNCAUGHT EXCEPTION:', err.message, err.stack);
    Sentry.captureException(err);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('UNHANDLED REJECTION:', reason);
    Sentry.captureException(reason instanceof Error ? reason : new Error(String(reason)));
    process.exit(1);
});

const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const db = require('./db');

// Call database initialization on startup
async function initializeDatabase() {
    console.log('Initializing database...');
    try {
        await db.initDb();
        console.log('Database initialized successfully using db.js schema');
    } catch (err) {
        console.error('Database initialization error:', err.message);
        Sentry.captureException(err);
    }
}
initializeDatabase();
const path = require('path');
const fs = require('fs');

// Auth Requires
const jwt = require('jsonwebtoken');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const session = require('express-session');
const cookieParser = require('cookie-parser');
const cookie = require('cookie');
const http = require('http');
const { Server } = require("socket.io");

const app = express();
app.get('/health', async (req, res) => {
    try {
        await db.query('SELECT 1');
        res.json({ status: 'ok', uptime: process.uptime() });
    } catch (err) {
        res.status(500).json({ status: 'error' });
    }
});

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
    maxHttpBufferSize: 1e7 // 10MB
});
const { createNotification, setIo: setNotifIo } = require('./notifications');
const { dispatchDueHomeworkReminders } = require('./services/homework-reminders');
const initChatSocket = require('./sockets/chat');
const calendarRouter        = require('./routes/calendar');
const studentsRouter        = require('./routes/students');
const sessionsRouter        = require('./routes/sessions');
const paymentsRouter        = require('./routes/payments');
const teachersRouter        = require('./routes/teachers');
const examsRouter           = require('./routes/exams');
const makeChatRouter        = require('./routes/chat');
const authRouter            = require('./routes/auth');
const aiRouter              = require('./routes/ai');
const notificationsRouter   = require('./routes/notifications');
const reportsRouter         = require('./routes/reports');
const settingsRouter        = require('./routes/settings');
const homeworkRemindersRouter = require('./routes/homework-reminders');
const makeTranscriptsRouter = require('./routes/transcripts');
setNotifIo(io);

io.use((socket, next) => {
  let token = socket.handshake.auth?.token;
  if (!token) {
    const cookies = cookie.parse(socket.handshake.headers.cookie || '');
    token = cookies.token;
  }
  if (!token) return next(new Error('No token'));
  try {
    const user = jwt.verify(token, process.env.JWT_SECRET);
    socket.user = user;
    next();
  } catch(e) {
    next(new Error('Invalid token'));
  }
});

initChatSocket(io);

const { checkAndProcessTranscripts } = require('./services/gmail')(io);
// ─────────────────────────────────────────────────────────────────────────────

// DAILY CRON JOBS
const initCrons = require('./cron');

const PORT = process.env.PORT || 3000;


// Required when behind a reverse proxy (Railway) so secure cookies and req.ip work correctly
if (process.env.NODE_ENV === 'production') {
    app.set('trust proxy', 1);
}

const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',')
    : ['http://localhost:3000'];
app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "cdnjs.cloudflare.com", "cdn.jsdelivr.net"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "fonts.googleapis.com", "cdnjs.cloudflare.com", "cdn.jsdelivr.net"],
      fontSrc: ["'self'", "fonts.gstatic.com", "cdnjs.cloudflare.com"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "ws:", "wss:"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      upgradeInsecureRequests: [],
    },
  },
}));

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false });
const registerLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false });
const aiLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false });
const globalLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 500, standardHeaders: true, legacyHeaders: false });
app.use('/api/', globalLimiter);
// Brute-force limiters must match the REAL endpoint paths (auth routes live at /auth/*, not /api/*)
app.use('/auth/login', loginLimiter);
app.use('/auth/register', registerLimiter);
app.use('/api/auth/join', registerLimiter);
app.use('/api/ai-tutor', aiLimiter);

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());
// Session secret: fail-fast in production; ephemeral random in dev to avoid blocking local work
let sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
    if (process.env.NODE_ENV === 'production') {
        console.error('[FATAL] SESSION_SECRET must be set in production');
        process.exit(1);
    }
    sessionSecret = require('crypto').randomBytes(32).toString('hex');
    console.warn('[WARN] SESSION_SECRET not set — using ephemeral dev secret. Sessions reset on restart.');
}
app.use(session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000
    }
}));
app.use(passport.initialize());
app.use(passport.session());
app.use(calendarRouter);
app.use(studentsRouter);
app.use(sessionsRouter);
app.use(paymentsRouter);
app.use(teachersRouter);
app.use(examsRouter);
app.use(makeChatRouter(io));
app.use(authRouter);
app.use(aiRouter);
app.use('/api', notificationsRouter);
app.use('/api', reportsRouter);
app.use('/api', settingsRouter);
app.use(homeworkRemindersRouter);
app.use(makeTranscriptsRouter(io));

// Public static files
app.use('/assets', express.static(path.join(__dirname, 'public/assets')));

passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID || 'dummy',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || 'dummy',
    callbackURL: `${process.env.BASE_URL || 'http://localhost:3000'}/auth/google/callback`,
    passReqToCallback: true
}, (req, accessToken, refreshToken, profile, cb) => cb(null, profile)));

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

// API Authentication Middlewares
const JWT_SECRET = process.env.JWT_SECRET;

const authenticateJWT = (req, res, next) => {
    let token = req.cookies.token;
    if (!token && req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
        token = req.headers.authorization.split(' ')[1];
    }

    if (token) {
        jwt.verify(token, JWT_SECRET, (err, user) => {
            if (err) {
                if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Unauthorized' });
                return res.redirect('/login');
            }
            req.user = user;
            next();
        });
    } else {
        if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Unauthorized' });
        res.redirect('/login');
    }
};

const requireRole = (role) => (req, res, next) => {
    if (req.user && req.user.role === role) next();
    else res.status(403).send('Forbidden');
};

const requireAdmin = requireRole('admin');
const requireTeacher = requireRole('teacher');
const requireStudent = requireRole('student');
const requireTeacherOrAdmin = (req, res, next) => {
    if (req.user && (req.user.role === 'teacher' || req.user.role === 'admin')) next();
    else res.status(403).send('Forbidden');
};

app.get('/landing', (req, res) => res.sendFile(path.join(__dirname, 'public', 'landing.html')));
app.get('/privacy', (req, res) => res.sendFile(path.join(__dirname, 'public', 'privacy.html')));
app.get('/privacy.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'privacy.html')));
app.get('/terms', (req, res) => res.sendFile(path.join(__dirname, 'public', 'terms.html')));
app.get('/terms.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'terms.html')));

// Auth Routes
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public/login.html')));
app.get('/register', (req, res) => res.sendFile(path.join(__dirname, 'public/register.html')));
app.get('/join', (req, res) => res.sendFile(path.join(__dirname, 'public/join.html')));
app.get('/auth-success', (req, res) => res.sendFile(path.join(__dirname, 'public', 'auth-success.html')));
// Page-level auth: redirect to /login instead of returning 401 JSON
const requireTeacherPage = (req, res, next) => {
    try {
        const token = req.cookies?.token;
        if (!token) return res.redirect('/login');
        const user = jwt.verify(token, process.env.JWT_SECRET);
        if (!['teacher', 'admin'].includes(user.role)) return res.redirect('/login');
        next();
    } catch { res.redirect('/login'); }
};
const requireStudentPage = (req, res, next) => {
    try {
        const token = req.cookies?.token;
        if (!token) return res.redirect('/login');
        const user = jwt.verify(token, process.env.JWT_SECRET);
        if (user.role !== 'student') return res.redirect('/login');
        next();
    } catch { res.redirect('/login'); }
};
const requireAdminPage = (req, res, next) => {
    try {
        const token = req.cookies?.token;
        if (!token) return res.redirect('/login');
        const user = jwt.verify(token, process.env.JWT_SECRET);
        if (user.role !== 'admin') return res.redirect('/login');
        next();
    } catch { res.redirect('/login'); }
};

app.get('/teacher', requireTeacherPage, (req, res) => res.sendFile(path.join(__dirname, 'public', 'teacher_dashboard.html')));
app.get('/teacher/dashboard', requireTeacherPage, (req, res) => res.sendFile(path.join(__dirname, 'public', 'teacher_dashboard.html')));
app.get('/teacher/sessions', requireTeacherPage, (req, res) => res.sendFile(path.join(__dirname, 'public', 'teacher_sessions.html')));
app.get('/teacher/exams', requireTeacherPage, (req, res) => res.sendFile(path.join(__dirname, 'public', 'teacher_exams.html')));
app.get('/teacher/students', requireTeacherPage, (req, res) => res.sendFile(path.join(__dirname, 'public', 'teacher_dashboard.html')));
app.get('/teacher/calendar', requireTeacherPage, (req, res) => res.sendFile(path.join(__dirname, 'public', 'teacher_calendar.html')));
app.get('/teacher/chat', requireTeacherPage, (req, res) => res.sendFile(path.join(__dirname, 'public', 'chat.html')));
app.get('/teacher/settings', requireTeacherPage, (req, res) => res.sendFile(path.join(__dirname, 'public', 'teacher_settings.html')));
app.get('/teacher/transcripts', requireTeacherPage, (req, res) => res.sendFile(path.join(__dirname, 'public', 'transcripts.html')));
app.get('/student', requireStudentPage, (req, res) => res.sendFile(path.join(__dirname, 'public', 'student_portal.html')));
app.get('/student-portal', requireStudentPage, (req, res) => res.sendFile(path.join(__dirname, 'public', 'student_portal.html')));



// Main Page Routes
app.get('/', (req, res) => {
    let token = req.cookies.token;
    if (!token && req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
        token = req.headers.authorization.split(' ')[1];
    }
    if (!token) return res.sendFile(path.join(__dirname, 'public/landing.html'));

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.sendFile(path.join(__dirname, 'public/landing.html'));
        if (user.role === 'admin') res.sendFile(path.join(__dirname, 'public/index.html'));
        else res.redirect(user.role === 'teacher' ? '/teacher/dashboard' : '/student-portal');
    });
});
app.get('/student-portal/exams', authenticateJWT, requireStudent, (req, res) => res.sendFile(path.join(__dirname, 'public/student_portal_exams.html')));
app.get('/student-portal/calendar', authenticateJWT, requireStudent, (req, res) => res.sendFile(path.join(__dirname, 'public/student_portal_calendar.html')));
app.get('/student-portal/payments', authenticateJWT, requireStudent, (req, res) => res.sendFile(path.join(__dirname, 'public/student_portal_payments.html')));
app.get('/exam-simulator', authenticateJWT, requireStudent, (req, res) => res.sendFile(path.join(__dirname, 'public/exam_simulator.html')));
app.get('/students', authenticateJWT, requireAdmin, (req, res) => res.sendFile(path.join(__dirname, 'public/students.html')));
app.get('/sessions', authenticateJWT, (req, res) => res.sendFile(path.join(__dirname, 'public/sessions.html')));
app.get('/calendar', authenticateJWT, requireAdmin, (req, res) => res.sendFile(path.join(__dirname, 'public/calendar.html')));
app.get('/exams', authenticateJWT, (req, res) => res.sendFile(path.join(__dirname, 'public/exams.html')));
app.get('/payments', authenticateJWT, (req, res) => res.sendFile(path.join(__dirname, 'public/payments.html')));
app.get('/ai-tutor', authenticateJWT, (req, res) => res.sendFile(path.join(__dirname, 'public/ai_tutor.html')));
app.get('/settings', authenticateJWT, requireAdmin, (req, res) => res.sendFile(path.join(__dirname, 'public/settings.html')));
app.get('/chat', authenticateJWT, (req, res) => res.sendFile(path.join(__dirname, 'public/chat.html')));
app.get('/student/:id', authenticateJWT, (req, res) => {
    if (req.user.role === 'admin') {
        res.sendFile(path.join(__dirname, 'public/student_profile.html'));
    } else if (req.user.role === 'teacher') {
        res.redirect(`/teacher/student/${req.params.id}`);
    } else {
        res.redirect('/student-portal');
    }
});

app.get('/teacher/student/:id', authenticateJWT, requireTeacherOrAdmin, (req, res) => {
    db.query('SELECT id FROM students WHERE id = $1 AND assigned_teacher_id = $2', [req.params.id, req.user.id], (err, result) => {
        const row = result?.rows[0];
        if (row) res.sendFile(path.join(__dirname, 'public/teacher_student_profile.html'));
        else res.redirect('/teacher/dashboard');
    });
});

// Admin Teacher Pages
app.get('/admin/teachers', requireAdminPage, (req, res) => res.sendFile(path.join(__dirname, 'public/admin_teachers.html')));
app.get('/admin/teacher/:id', requireAdminPage, (req, res) => res.sendFile(path.join(__dirname, 'public/admin_teacher_profile.html')));
app.get('/admin', (req, res) => res.redirect('/'));
app.get('/dashboard', (req, res) => res.redirect('/'));





// Add express static for other files (must be AFTER root and routes)
// Serve everything EXCEPT /uploads (which is protected below)
app.use(express.static(path.join(__dirname, 'public'), {
    index: false,
    // Block direct access to uploads — handled by the authenticated route below
    setHeaders: (res, filePath) => {
        if (filePath.includes(path.sep + 'uploads' + path.sep)) {
            res.status(403).end();
        }
    }
}));

// Authenticated file serving for uploads
app.get('/uploads/:folder/:filename', (req, res, next) => {
    // Return JSON 401 (not a redirect) so API clients handle it correctly
    const token = req.cookies?.token ||
        (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.split(' ')[1] : null);
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    next();
}, authenticateJWT, (req, res) => {
    const { folder, filename } = req.params;
    // Only allow known upload folders
    if (!['chat', 'reports'].includes(folder)) return res.status(404).end();

    // Prevent path traversal
    const safeName = path.basename(filename);
    const filePath = path.join(__dirname, 'public', 'uploads', folder, safeName);

    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Archivo no encontrado' });
    res.sendFile(filePath);
});













// NOTE: generic PUT/DELETE /api/{students,sessions,exams,payments}/:id removed.
// PUT + sessions/exams/payments DELETE were shadowed (dead) by their routers;
// DELETE /api/students/:id was the only live one and had no role check — a student
// could delete peers. Admin delete goes through /api/admin/students/:id (requireAdmin).





// ─── Sentry express error handler (must be after all routes) ─────────────────
Sentry.setupExpressErrorHandler(app);
// Central error handler: sanitizes responses, logs internally, reports to Sentry
app.use(require('./middleware/errorHandler'));
// ─────────────────────────────────────────────────────────────────────────────

db.initDb().then(async () => {
    try {
        await db.query(`
            INSERT INTO students (name, email, course, subject, status, academy_id, user_id)
            SELECT u.name, u.email, 'Sin asignar', 'Sin asignar', 'active', u.academy_id, u.id
            FROM users u 
            WHERE u.role = 'student' 
            AND u.id NOT IN (SELECT user_id FROM students WHERE user_id IS NOT NULL)
        `);
    } catch(e) {
        console.log('Student table sync with email failed, trying without email column:', e.message);
        try {
            await db.query(`
                INSERT INTO students (name, course, subject, status, academy_id, user_id)
                SELECT u.name, 'Sin asignar', 'Sin asignar', 'active', u.academy_id, u.id
                FROM users u 
                WHERE u.role = 'student' 
                AND u.id NOT IN (SELECT user_id FROM students WHERE user_id IS NOT NULL)
            `);
        } catch(e2) {
            console.log('Student table auto-sync completely failed:', e2.message);
        }
    }

    server.listen(PORT, () => {
        console.log('Server running on port ' + PORT);

        console.log('DATABASE_URL:', process.env.DATABASE_URL ? 'SET' : 'NOT SET');
        console.log('NODE_ENV:', process.env.NODE_ENV);
        console.log('DB TYPE:', process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('your_postgres') ? 'PostgreSQL' : 'SQLite');

        // ensureAllChatRooms(); // Disabled to fix duplicates
        initCrons();

        // Auto-check Gmail transcripts every 15 minutes for all connected teachers
        setInterval(async () => {
            try {
                const result = await db.query(
                    "SELECT * FROM users WHERE role IN ('teacher', 'admin') AND gmail_access_token IS NOT NULL"
                );
                const teachers = result.rows || [];
                for (const teacher of teachers) {
                    await checkAndProcessTranscripts(teacher).catch(e =>
                        console.error('[Gmail] Auto-check error for teacher', teacher.id, ':', e.message)
                    );
                }
                if (teachers.length) console.log(`[Gmail] Auto-check: ${teachers.length} teacher(s) processed`);
            } catch (err) {
                console.error('[Gmail] Auto-check interval error:', err.message);
            }
        }, 15 * 60 * 1000);

        // Class reminder: notify students 15 minutes before class (check every minute)
        setInterval(async () => {
            try {
                const now = new Date();
                const in15 = new Date(now.getTime() + 15 * 60 * 1000);
                const slots = await db.query(`
                    SELECT s.id, s.meet_link, s.start_datetime,
                           st.user_id as student_user_id, st.academy_id
                    FROM available_slots s
                    JOIN students st ON s.student_id = st.id
                    WHERE s.is_booked = TRUE
                      AND s.meet_link IS NOT NULL
                      AND s.reminder_sent = FALSE
                      AND s.start_datetime > $1
                      AND s.start_datetime <= $2
                `, [now.toISOString(), in15.toISOString()]);
                for (const slot of (slots.rows || [])) {
                    await createNotification(
                        slot.student_user_id,
                        slot.academy_id,
                        'class_reminder',
                        '🎥 Tu clase empieza en 15 minutos',
                        'Haz clic para unirte a la videollamada',
                        slot.meet_link
                    );
                    await db.query('UPDATE available_slots SET reminder_sent = TRUE WHERE id = $1', [slot.id]);
                }
            } catch (err) {
                console.error('[Calendar] Class reminder error:', err.message);
            }
        }, 60 * 1000);

        setInterval(async () => {
            try {
                await dispatchDueHomeworkReminders({
                    dbRunner: db,
                    createNotificationFn: createNotification
                });
            } catch (err) {
                console.error('[Homework] Reminder dispatch error:', err.message);
            }
        }, 60 * 1000);
    });
}).catch(err => {
    console.error('Failed to initialize database:', err);
});
