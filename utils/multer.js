'use strict';

const multer = require('multer');
const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');

const ALLOWED_CHAT_EXTS  = new Set(['.pdf', '.jpg', '.jpeg', '.png', '.doc', '.docx']);
const ALLOWED_CHAT_MIMES = new Set([
    'application/pdf', 'image/jpeg', 'image/png',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
]);
const safeFilename = (file) => crypto.randomBytes(16).toString('hex') + path.extname(file.originalname).toLowerCase();

// ── PDF / memory upload (for transcript processing, AI extract) ───────────────
const pdfUpload = multer({
    storage: multer.memoryStorage(),
    limits:  { fileSize: 10 * 1024 * 1024 }
});

// ── Chat disk upload (legacy /api/chat/upload) ────────────────────────────────
const upload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, 'public/uploads/chat/'),
        filename:    (req, file, cb) => cb(null, safeFilename(file))
    }),
    limits:     { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (ALLOWED_CHAT_EXTS.has(ext) && ALLOWED_CHAT_MIMES.has(file.mimetype)) cb(null, true);
        else cb(new Error('Formato no permitido'));
    }
});

// ── Chat file upload with directory auto-creation (/api/chat/upload-file) ────
const chatUpload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => {
            const dir = path.join(__dirname, '../public/uploads/chat');
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            cb(null, dir);
        },
        filename: (req, file, cb) => cb(null, safeFilename(file))
    }),
    limits:     { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (ALLOWED_CHAT_EXTS.has(ext) && ALLOWED_CHAT_MIMES.has(file.mimetype)) cb(null, true);
        else cb(new Error('Tipo de archivo no permitido'));
    }
}).single('file');

module.exports = { pdfUpload, upload, chatUpload };
