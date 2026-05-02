// CarrierDataPro Backend - Vercel Serverless + Supabase + Firebase Auth

const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3001;

// ══════════════════════════════════════════════════════════
// CONFIGURATION
// ══════════════════════════════════════════════════════════

// Supabase Setup (Will be set in Vercel Environment Variables)
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ivfmfgratswtpecjxgph.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY; 
let supabase;

if (SUPABASE_SERVICE_KEY) {
    supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    console.log('✅ Supabase initialized');
}

// Firebase Admin SDK Config for Token Verification
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
} else {
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
        'http://127.0.0.1:5500'
    ],
    credentials: true
}));
app.use(express.json({ limit: '10mb' }));

async function verifyAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    try {
        const token = authHeader.split('Bearer ')[1];
        const decoded = await admin.auth().verifyIdToken(token);
        req.user = decoded;
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Invalid token' });
    }
}

// ══════════════════════════════════════════════════════════
// ROUTES
// ══════════════════════════════════════════════════════════

app.get('/', (req, res) => {
    res.json({ status: 'ok', service: 'CarrierDataPro Vercel/Supabase Backend' });
});

// ── CHECK DUPLICATES ───────────────────────────────────────
app.post('/api/check-duplicates', verifyAuth, async (req, res) => {
    if (!supabase) return res.status(500).json({ error: 'Supabase URL/KEY missing' });
    
    try {
        const { records } = req.body;
        const userId = req.user.uid;

        if (!records || records.length === 0) return res.json({ newRecords: [] });

        const { data: history, error } = await supabase
            .from('user_records')
            .select('phone, company_lower')
            .eq('user_id', userId);

        if (error) throw error;

        const historyPhones = new Set();
        const historyCompanies = new Set();

        (history || []).forEach(h => {
            if (h.phone && h.phone.length >= 10) historyPhones.add(h.phone);
            if (h.company_lower && h.company_lower.length > 2 && h.company_lower !== 'unknown') {
                historyCompanies.add(h.company_lower);
            }
        });

        const newRecordIndices = [];
        for (let i = 0; i < records.length; i++) {
            const r = records[i];
            const cleanPhone = (r.phone || '').replace(/\D/g, '');
            const cleanCompany = (r.company || '').trim().toLowerCase();

            let isDuplicate = false;
            
            if (cleanPhone && cleanPhone.length >= 10 && historyPhones.has(cleanPhone)) {
                isDuplicate = true;
            }
            
            if (!isDuplicate && cleanCompany && cleanCompany.length > 2 && cleanCompany !== 'unknown') {
                if (historyCompanies.has(cleanCompany)) isDuplicate = true;
            }

            if (!isDuplicate) newRecordIndices.push(i);
        }

        res.json({ 
            newRecords: newRecordIndices,
            totalChecked: records.length,
            duplicatesFound: records.length - newRecordIndices.length,
            historySize: history ? history.length : 0
        });

    } catch (err) {
        console.error('Check duplicates error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ── SAVE RECORDS ───────────────────────────────────────────
app.post('/api/save-records', verifyAuth, async (req, res) => {
    if (!supabase) return res.status(500).json({ error: 'Supabase URL/KEY missing' });

    try {
        const { records } = req.body;
        const userId = req.user.uid;

        if (!records || records.length === 0) return res.json({ saved: 0 });

        const docs = records.map(r => ({
            user_id: userId,
            phone: (r.phone || '').replace(/\D/g, ''),
            company_name: (r.company || r.companyName || '').trim(),
            company_lower: (r.companyLower || r.company || '').trim().toLowerCase(),
            category: r.category || ''
        }));

        const { data, error } = await supabase
            .from('user_records')
            .insert(docs);

        if (error) throw error;

        res.json({ saved: docs.length, message: 'Saved to Supabase' });

    } catch (err) {
        console.error('Save records error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ── GET HISTORY ────────────────────────────────────────────
app.get('/api/history', verifyAuth, async (req, res) => {
    if (!supabase) return res.status(500).json({ error: 'Supabase URL/KEY missing' });

    try {
        const userId = req.user.uid;
        const limit = parseInt(req.query.limit) || 100;
        const page = parseInt(req.query.page) || 1;
        const skip = (page - 1) * limit;

        const { data: records, error, count } = await supabase
            .from('user_records')
            .select('*', { count: 'exact' })
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .range(skip, skip + limit - 1);

        if (error) throw error;
        res.json({ records, total: count, page, limit });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── GET STATS ──────────────────────────────────────────────
app.get('/api/stats', verifyAuth, async (req, res) => {
    if (!supabase) return res.status(500).json({ error: 'Supabase URL/KEY missing' });

    try {
        const userId = req.user.uid;
        const { data, error, count } = await supabase
            .from('user_records')
            .select('phone, company_lower', { count: 'exact' })
            .eq('user_id', userId);

        if (error) throw error;

        const uniquePhones = new Set((data || []).filter(r => r.phone).map(r => r.phone));
        const uniqueCompanies = new Set((data || []).filter(r => r.company_lower && r.company_lower !== 'unknown').map(r => r.company_lower));

        res.json({
            totalRecords: count,
            uniquePhones: uniquePhones.size,
            uniqueCompanies: uniqueCompanies.size
        });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = app;

if (require.main === module) {
    app.listen(PORT, () => console.log(`Vercel Backend testing locally on port ${PORT}`));
}
