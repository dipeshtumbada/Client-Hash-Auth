// ==================== server.js ====================

const express = require('express');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const crypto = require('crypto');
const Hash = require('./models/Hash');
const cron = require('node-cron');
const path = require('path');

dotenv.config();

const app = express();
app.use(express.json());
app.use(express.static('public'));

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
}).then(() => console.log("✅ Connected to MongoDB"))
  .catch(err => console.error("❌ MongoDB connection error:", err));

// Helper functions
function generateKey(clientName, startDate, endDate, cin) {
  const rawKey = `${clientName}-${startDate}-${endDate}-${cin}`;
  return crypto.createHash('sha256').update(rawKey).digest('hex').substring(0, 16);
}

function generateDailyHash(key) {
  const today = new Date().toISOString().slice(0, 10);
  return crypto.createHash('sha256').update(key + today).digest('hex');
}

// ==================== ROUTES ====================

// Serve HTML page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Get all client data
app.get('/allClients', async (req, res) => {
  try {
    const clients = await Hash.find();
    res.json(clients);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch clients' });
  }
});

// Generate and store hash on registration
app.post('/generateHash', async (req, res) => {
  const { clientName, startDate, endDate, cin } = req.body;

  if (!clientName || !startDate || !endDate || !cin) {
    return res.status(400).json({ error: "All fields are required." });
  }

  const shortKey = generateKey(clientName, startDate, endDate, cin);
  const dailyHash = generateDailyHash(shortKey);
  const dateGenerated = new Date().toISOString().slice(0, 10);

  try {
    const existing = await Hash.findOne({ clientName, cin });
    if (existing) {
      return res.status(409).json({ error: "Client already registered." });
    }

    const newEntry = new Hash({
      clientName,
      startDate,
      endDate,
      cin,
      shortKey,
      hashes: [{ date: dateGenerated, hash: dailyHash }],
      pingLog: []
    });

    await newEntry.save();
    res.json({ message: "✅ Hash generated and stored!", shortKey, dailyHash });
  } catch (err) {
    console.error("❌ Error saving hash:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// Delete a client by ID
app.delete('/deleteClient/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await Hash.findByIdAndDelete(id);
    res.json({ message: '🗑️ Client deleted successfully' });
  } catch (error) {
    console.error('❌ Error deleting client:', error);
    res.status(500).json({ error: 'Failed to delete client' });
  }
});


// Verify hash and log ping
app.post('/verifyHash', async (req, res) => {
  try {
    const { clientName, cin } = req.body;

    const client = await Hash.findOne({ clientName, cin });
    if (!client) return res.status(404).json({ valid: false, message: '❌ Client not found' });
    if (client.locked) return res.status(403).json({ valid: false, message: '🔒 Client is locked' });

    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);
    const timeStr = today.toLocaleTimeString('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour12: false
    });

    if (todayStr < client.startDate || todayStr > client.endDate) {
      return res.status(403).json({ valid: false, message: '📅 Date not within active range' });
    }

    const key = generateKey(client.clientName, client.startDate, client.endDate, client.cin);
    const todayHash = generateDailyHash(key);

    const todayHashRecord = client.hashes.find(h => h.date === todayStr);

    if (!todayHashRecord || todayHashRecord.hash !== todayHash) {
      return res.status(400).json({ valid: false, message: '❌ Hash does not match today\'s hash' });
    }

    client.pingLog.push({ date: todayStr, time: timeStr });
    await client.save();

    return res.status(200).json({ valid: true, message: '✅ Hash is valid and ping logged' });

  } catch (error) {
    console.error('❌ Error in verifyHash:', error);
    res.status(500).json({ valid: false, message: 'Internal server error' });
  }
});

// Manually trigger today's hash generation for all clients
app.post('/generateTodayHashes', async (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const clients = await Hash.find({ locked: false });
  let count = 0;

  for (const client of clients) {
    const key = generateKey(client.clientName, client.startDate, client.endDate, client.cin);
    const dailyHash = generateDailyHash(key);

    const alreadyExists = client.hashes.find(h => h.date === today);
    if (!alreadyExists) {
      client.hashes.push({ date: today, hash: dailyHash });
      await client.save();
      count++;
    }
  }

  res.json({ message: `✅ Today's hash generated for ${count} clients.` });
});

// ==================== DAILY CRON ====================

// cron.schedule('*/2 * * * *', async () => {
//   console.log('🕵️‍♂️ Running ping and lock check every 2 minutes...');

//   const now = new Date();
//   const twoMinutesAgo = new Date(now);
//   twoMinutesAgo.setMinutes(now.getMinutes() - 2); // 2 minutes ago

//   const clients = await Hash.find();

//   for (const client of clients) {
//     const key = generateKey(client.clientName, client.startDate, client.endDate, client.cin);
//     const todayHash = generateDailyHash(key);
//     const exists = client.hashes.find(h => h.date === now.toISOString().slice(0, 10));

//     if (!exists) {
//       client.hashes.push({ date: now.toISOString().slice(0, 10), hash: todayHash });
//       console.log(`✅ Today's hash generated for ${client.clientName}`);
//     }

//     // Check if last ping was more than 2 minutes ago
//     const lastPing = client.pingLog[client.pingLog.length - 1];
//     if (!lastPing || new Date(lastPing.date + ' ' + lastPing.time) < twoMinutesAgo) {
//       if (!client.locked) {
//         client.locked = true; // Lock the client
//         console.log(`🔒 Locked client due to inactivity: ${client.clientName}`);
//       }
//     }

//     await client.save();
//   }
// });

cron.schedule('0 0 * * *', async () => {
  console.log('🕵️‍♂️ Running inactivity check at midnight...');

  const now = new Date();
  const twoDaysAgo = new Date(now);
  twoDaysAgo.setDate(now.getDate() - 2); // 2 days ago

  const clients = await Hash.find();

  for (const client of clients) {
    // Check if last ping was more than 2 days ago
    const lastPing = client.pingLog[client.pingLog.length - 1];
    if (!lastPing || new Date(lastPing.date + ' ' + lastPing.time) < twoDaysAgo) {
      if (!client.locked) {
        client.locked = true; // Lock the client after 2 days of inactivity
        console.log(`🔒 Locked client due to inactivity (more than 2 days): ${client.clientName}`);
      }
    }

    await client.save();
  }
});

// Reactivate a client by ID
app.post('/reactivateClient/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const client = await Hash.findById(id);
    
    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    if (!client.locked) {
      return res.status(400).json({ error: 'Client is not locked' });
    }

    client.locked = false; // Unlock the client
    await client.save();

    res.json({ message: '✅ Client reactivated successfully' });
  } catch (error) {
    console.error('❌ Error reactivating client:', error);
    res.status(500).json({ error: 'Failed to reactivate client' });
  }
});


// ==================== START SERVER ====================

app.listen(process.env.PORT, () => {
  console.log(`🚀 Server running on http://localhost:${process.env.PORT}`);
});