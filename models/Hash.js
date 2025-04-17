// ==================== models/Hash.js ====================

const mongoose = require('mongoose');

const HashSchema = new mongoose.Schema({
  clientName: String,
  startDate: String,
  endDate: String,
  cin: String,
  shortKey: String,
  hashes: [{
    date: String,
    hash: String
  }],
  pingLog: [{
    date: String,
    time: String
  }],
  locked: {
    type: Boolean,
    default: false
  }
});

module.exports = mongoose.model('Hash', HashSchema);