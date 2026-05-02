// CarrierDataPro Backend - Express + MongoDB + Firebase Auth
// Deploy on Render.com (FREE)

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const admin = require('firebase-admin');
const UserRecord = require('./models/UserRecord');

const app = express();
const PORT = process.env.PORT || 3001;

// ══════════════════════════════════════════════════════════
// CONFIGURATION
// ══════════════════════════════════════════════════════════

// MongoDB Atlas connection string (set in Render environment variables)
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://aworkspace748_db_user:6a27d5Eyc2evkRJk@carrierdatacluster.gz8kubk.mongodb.net/carrierdata?retryWrites=true&w=majority&appName=CarrierDataCluster';

// Firebase Admin SDK (for verifying auth tokens)
// On Render.com, set FIREBASE_SERVICE_ACCOUNT env variable with the JSON
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
} else {
    // For local development - uses default credentials
    admin.initializeApp({
        projectId: 'cold-messenger-d6d43'
    });
}

// ══════════════════════════════════════════════════════════
// MIDDLEWARE
// ══════════════════════════════════════════════════════════

app.use(cors({
    origin: [
        'https://carrier-data-pro.web.app',
        'https://carrier-data-pro.firebaseapp.com',
        'http://localhost:5000',
        'http://localhost:3000',
        'http://127.0.0.1:5500'  // VS Code Live Server
    ],
    credentials: true
}));
app.use(express.json({ limit: '10mb' }));

// Auth middleware - verify Firebase token
async function verifyAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized - No token provided' });
    }

    try {
        const token = authHeader.split('Bearer ')[1];
        const decoded = await admin.auth().verifyIdToken(token);
        req.user = decoded;
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Unauthorized - Invalid token' });
    }
}

// ══════════════════════════════════════════════════════════
// ROUTES
// ══════════════════════════════════════════════════════════

// Health check
app.get('/', (req, res) => {
    res.json({ status: 'ok', service: 'CarrierDataPro Backend', version: '1.0' });
});

// ── CHECK DUPLICATES ───────────────────────────────────────
// Receives array of records, returns which ones are NEW (not duplicates)
app.post('/api/check-duplicates', verifyAuth, async (req, res) => {
    try {
        const { records } = req.body;
        const userId = req.user.uid;

        if (!records || !Array.isArray(records) || records.length === 0) {
            return res.json({ newRecords: [] });
        }

        // Fetch ALL of this user's history from MongoDB
        const history = await UserRecord.find(
            { userId },
            { phone: 1, companyLower: 1, _id: 0 }
        ).lean();

        // Build lookup sets for fast matching
        const historyPhones = new Set();
        const historyCompanies = new Set();

        history.forEach(h => {
            if (h.phone && h.phone.length >= 10) historyPhones.add(h.phone);
            if (h.companyLower && h.companyLower.length > 2 && h.companyLower !== 'unknown') {
                historyCompanies.add(h.companyLower);
            }
        });

        // Check each record against history
        const newRecordIndices = [];
        
        for (let i = 0; i < records.length; i++) {
            const r = records[i];
            const cleanPhone = (r.phone || '').replace(/\D/g, '');
            const cleanCompany = (r.company || '').trim().toLowerCase();

            let isDuplicate = false;

            // Check phone match (if phone exists and is valid)
            if (cleanPhone && cleanPhone.length >= 10 && historyPhones.has(cleanPhone)) {
                isDuplicate = true;
            }

            // Check company name match (if company exists and is meaningful)
            if (!isDuplicate && cleanCompany && cleanCompany.length > 2 && cleanCompany !== 'unknown') {
                if (historyCompanies.has(cleanCompany)) {
                    isDuplicate = true;
                }
            }

            if (!isDuplicate) {
                newRecordIndices.push(i);
            }
        }

        res.json({ 
            newRecords: newRecordIndices,
            totalChecked: records.length,
            duplicatesFound: records.length - newRecordIndices.length,
            historySize: history.length
        });

    } catch (err) {
        console.error('Check duplicates error:', err);
        res.status(500).json({ error: 'Server error checking duplicates' });
    }
});

// ── SAVE RECORDS ───────────────────────────────────────────
// Save new records to MongoDB after CSV download
app.post('/api/save-records', verifyAuth, async (req, res) => {
    try {
        const { records } = req.body;
        const userId = req.user.uid;
        const userEmail = req.user.email || 'unknown';

        if (!records || !Array.isArray(records) || records.length === 0) {
            return res.json({ saved: 0 });
        }

        // Prepare documents for bulk insert
        const docs = records.map(r => ({
            userId,
            userEmail,
            phone: (r.phone || '').replace(/\D/g, ''),
            companyName: (r.company || r.companyName || '').trim(),
            companyLower: (r.companyLower || r.company || '').trim().toLowerCase(),
            mcNumber: r.mc || '',
            category: r.category || '',
            date: r.date || '',
            savedAt: new Date()
        }));

        // Bulk insert (skip duplicates within this batch)
        const result = await UserRecord.insertMany(docs, { ordered: false }).catch(err => {
            // Ignore duplicate key errors
            if (err.code === 11000) return { insertedCount: docs.length - (err.writeErrors?.length || 0) };
            throw err;
        });

        res.json({ 
            saved: result.insertedCount || docs.length,
            message: 'Records saved successfully'
        });

    } catch (err) {
        console.error('Save records error:', err);
        res.status(500).json({ error: 'Server error saving records' });
    }
});

// ── GET HISTORY ────────────────────────────────────────────
// Get user's complete record history
app.get('/api/history', verifyAuth, async (req, res) => {
    try {
        const userId = req.user.uid;
        const limit = parseInt(req.query.limit) || 100;
        const page = parseInt(req.query.page) || 1;
        const skip = (page - 1) * limit;

        const [records, total] = await Promise.all([
            UserRecord.find({ userId })
                .sort({ savedAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            UserRecord.countDocuments({ userId })
        ]);

        res.json({ records, total, page, limit });

    } catch (err) {
        console.error('Get history error:', err);
        res.status(500).json({ error: 'Server error fetching history' });
    }
});

// ── GET STATS ──────────────────────────────────────────────
app.get('/api/stats', verifyAuth, async (req, res) => {
    try {
        const userId = req.user.uid;
        
        const [total, uniquePhones, uniqueCompanies] = await Promise.all([
            UserRecord.countDocuments({ userId }),
            UserRecord.distinct('phone', { userId, phone: { $ne: '' } }),
            UserRecord.distinct('companyLower', { userId, companyLower: { $ne: '' }, companyLower: { $ne: 'unknown' } })
        ]);

        res.json({
            totalRecords: total,
            uniquePhones: uniquePhones.length,
            uniqueCompanies: uniqueCompanies.length
        });

    } catch (err) {
        console.error('Get stats error:', err);
        res.status(500).json({ error: 'Server error fetching stats' });
    }
});

// ══════════════════════════════════════════════════════════
// DATABASE CONNECTION & START
// ══════════════════════════════════════════════════════════

mongoose.connect(MONGODB_URI)
    .then(() => {
        console.log('✅ Connected to MongoDB Atlas');
        app.listen(PORT, () => {
            console.log(`🚀 CarrierDataPro Backend running on port ${PORT}`);
        });
    })
    .catch(err => {
        console.error('❌ MongoDB connection failed:', err.message);
        process.exit(1);
    });
