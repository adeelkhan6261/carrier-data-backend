const mongoose = require('mongoose');

const userRecordSchema = new mongoose.Schema({
    userId: { 
        type: String, 
        required: true, 
        index: true 
    },
    userEmail: { 
        type: String, 
        required: true 
    },
    phone: { 
        type: String,  // Cleaned digits only
        default: '' 
    },
    companyName: { 
        type: String,  // Original casing
        default: '' 
    },
    companyLower: { 
        type: String,  // Lowercase for matching
        default: '' 
    },
    mcNumber: { 
        type: String, 
        default: '' 
    },
    category: { 
        type: String, 
        default: '' 
    },
    date: { 
        type: String, 
        default: '' 
    },
    savedAt: { 
        type: Date, 
        default: Date.now 
    }
});

// Compound indexes for fast per-user lookups
userRecordSchema.index({ userId: 1, phone: 1 });
userRecordSchema.index({ userId: 1, companyLower: 1 });
userRecordSchema.index({ userId: 1, savedAt: -1 });

module.exports = mongoose.model('UserRecord', userRecordSchema);
