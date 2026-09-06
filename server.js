// Transitline backend — real accounts, real bus GPS storage, real per-user alerts.
// Deploy this to Render (see README.md) — it replaces the in-memory JS objects that
// the ops-center.html frontend currently uses, so the data survives page reloads and
// is shared correctly across every device instead of living in one browser tab.

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
app.use(cors());
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('render.com')
    ? { rejectUnauthorized: false }
    : false
});

// ---------- auth helpers ----------
function signToken(account) {
  return jwt.sign(
    { staffId: account.staff_id, name: account.name, role: account.role, isAdmin: account.is_admin, busName: account.bus_name },
    JWT_SECRET,
    { expiresIn: '5h' } // matches the 5-minute *inactivity* auto-sign-out the frontend enforces separately
  );
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing auth token' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user.isAdmin) return res.status(403).json({ error: 'Admin access required' });
  next();
}

function publicAccount(row) {
  return { staffId: row.staff_id, name: row.name, role: row.role, isAdmin: row.is_admin, busName: row.bus_name };
}

// ---------- health check ----------
app.get('/api/health', (req, res) => res.json({ ok: true }));

// ---------- auth: sign up ----------
app.post('/api/signup', async (req, res) => {
  const { name, staffId, password, role, route, schoolName, schoolLat, schoolLng } = req.body || {};
  if (!name || !staffId || !password || !role) {
    return res.status(400).json({ error: 'name, staffId, password, and role are required' });
  }
  const id = staffId.trim().toLowerCase();
  const isAdmin = role === 'admin';
  const busName = !isAdmin ? (route || `${name}'s bus`) : null;
  const roleLabel = isAdmin ? 'District Admin' : `Bus driver${route ? ' — ' + route : ''}`;

  try {
    const existing = await pool.query('SELECT 1 FROM accounts WHERE staff_id = $1', [id]);
    if (existing.rowCount > 0) return res.status(409).json({ error: 'That Staff ID is already taken' });

    const passwordHash = await bcrypt.hash(password, 10);
    const inserted = await pool.query(
      `INSERT INTO accounts (staff_id, name, password_hash, role, is_admin, bus_name)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [id, name, passwordHash, roleLabel, isAdmin, busName]
    );

    if (isAdmin && schoolName && typeof schoolLat === 'number' && typeof schoolLng === 'number') {
      await pool.query('UPDATE school SET name=$1, lat=$2, lng=$3 WHERE id=1', [schoolName, schoolLat, schoolLng]);
    }

    await pool.query(
      `INSERT INTO alerts (owner_staff_id, tag, title, sub) VALUES ($1,'info',$2,$3)`,
      [id, `${name} signed in`, roleLabel]
    );

    const account = inserted.rows[0];
    res.json({ token: signToken(account), account: publicAccount(account) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error creating account' });
  }
});

// ---------- auth: log in ----------
app.post('/api/login', async (req, res) => {
  const { staffId, password } = req.body || {};
  if (!staffId || !password) return res.status(400).json({ error: 'staffId and password are required' });
  const id = staffId.trim().toLowerCase();

  try {
    const result = await pool.query('SELECT * FROM accounts WHERE staff_id = $1', [id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'No account with that Staff ID' });
    const account = result.rows[0];
    const ok = await bcrypt.compare(password, account.password_hash);
    if (!ok) return res.status(401).json({ error: 'Incorrect password' });

    await pool.query(
      `INSERT INTO alerts (owner_staff_id, tag, title, sub) VALUES ($1,'info',$2,$3)`,
      [id, `${account.name} signed in`, account.role]
    );

    res.json({ token: signToken(account), account: publicAccount(account) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error logging in' });
  }
});

// ---------- admin: add a driver directly ----------
app.post('/api/drivers', requireAuth, requireAdmin, async (req, res) => {
  const { name, staffId, password, route } = req.body || {};
  if (!name || !staffId || !password) return res.status(400).json({ error: 'name, staffId, and password are required' });
  const id = staffId.trim().toLowerCase();
  const busName = route || `${name}'s bus`;
  const roleLabel = `Bus driver${route ? ' — ' + route : ''}`;

  try {
    const existing = await pool.query('SELECT 1 FROM accounts WHERE staff_id = $1', [id]);
    if (existing.rowCount > 0) return res.status(409).json({ error: 'That Staff ID is already taken' });

    const passwordHash = await bcrypt.hash(password, 10);
    await pool.query(
      `INSERT INTO accounts (staff_id, name, password_hash, role, is_admin, bus_name) VALUES ($1,$2,$3,$4,FALSE,$5)`,
      [id, name, passwordHash, roleLabel, busName]
    );
    await pool.query(
      `INSERT INTO alerts (owner_staff_id, tag, title, sub) VALUES ($1,'',$2,$3)`,
      [req.user.staffId, `Driver added: ${name}`, route || 'unassigned route']
    );
    res.json({ ok: true, staffId: id, busName });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error adding driver' });
  }
});

// ---------- buses: report/update GPS (called by the map's manual entry, or a driver's device) ----------
app.post('/api/buses/gps', requireAuth, async (req, res) => {
  const { busName, sub, lat, lng } = req.body || {};
  if (!busName || typeof lat !== 'number' || typeof lng !== 'number') {
    return res.status(400).json({ error: 'busName, lat, and lng are required' });
  }
  try {
    const existing = await pool.query('SELECT 1 FROM buses WHERE bus_name = $1', [busName]);
    await pool.query(
      `INSERT INTO buses (bus_name, sub, lat, lng, updated_at) VALUES ($1,$2,$3,$4, now())
       ON CONFLICT (bus_name) DO UPDATE SET sub = COALESCE(EXCLUDED.sub, buses.sub), lat=$3, lng=$4, updated_at=now()`,
      [busName, sub || null, lat, lng]
    );
    const verb = existing.rowCount > 0 ? 'GPS updated' : 'added to fleet';
    await pool.query(
      `INSERT INTO alerts (owner_staff_id, tag, title, sub) VALUES ($1,'info',$2,$3)`,
      [req.user.staffId, `${busName} ${verb}`, sub || '']
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error updating bus GPS' });
  }
});

// ---------- buses: list all current positions (public to any signed-in user — the map polls this) ----------
app.get('/api/buses', requireAuth, async (req, res) => {
  try {
    const result = await pool.query('SELECT bus_name, sub, lat, lng, updated_at FROM buses ORDER BY bus_name');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error listing buses' });
  }
});

// ---------- alerts: only ever the signed-in user's own history ----------
app.get('/api/alerts', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT tag, title, sub, created_at FROM alerts WHERE owner_staff_id = $1 ORDER BY created_at DESC LIMIT 20',
      [req.user.staffId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error fetching alerts' });
  }
});

// ---------- school: read current location / update it (admin only) ----------
app.get('/api/school', requireAuth, async (req, res) => {
  const result = await pool.query('SELECT name, lat, lng FROM school WHERE id = 1');
  res.json(result.rows[0]);
});

app.post('/api/school', requireAuth, requireAdmin, async (req, res) => {
  const { name, lat, lng } = req.body || {};
  if (!name || typeof lat !== 'number' || typeof lng !== 'number') {
    return res.status(400).json({ error: 'name, lat, and lng are required' });
  }
  await pool.query('UPDATE school SET name=$1, lat=$2, lng=$3 WHERE id=1', [name, lat, lng]);
  await pool.query(
    `INSERT INTO alerts (owner_staff_id, tag, title, sub) VALUES ($1,'info','School location updated',$2)`,
    [req.user.staffId, name]
  );
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Transitline backend listening on port ${PORT}`));
