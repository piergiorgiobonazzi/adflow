require('dotenv').config()

const express = require('express')
const cors = require('cors')
const path = require('path')

const app = express()
const PORT = process.env.PORT || 3001
const META_VERSION = process.env.META_API_VERSION || 'v19.0'
const META_BASE = `https://graph.facebook.com/${META_VERSION}`

app.use(express.json())

const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:5173')
  .split(',')
  .map(s => s.trim())

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true)
    cb(new Error('Not allowed by CORS'))
  },
  methods: ['GET', 'POST', 'PATCH', 'DELETE'],
}))

// Resolve the token: env var takes precedence, then request header
function resolveToken(req) {
  return process.env.META_ACCESS_TOKEN || req.headers['x-meta-token'] || ''
}

// Generic Meta API GET proxy
async function metaGet(path, params, token) {
  const url = new URL(`${META_BASE}${path}`)
  url.searchParams.set('access_token', token)
  for (const [k, v] of Object.entries(params || {})) {
    if (v !== undefined && v !== '') url.searchParams.set(k, v)
  }
  const res = await fetch(url.toString())
  return res.json()
}

// Generic Meta API POST proxy
async function metaPost(path, body, token) {
  const url = new URL(`${META_BASE}${path}`)
  url.searchParams.set('access_token', token)
  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return res.json()
}

function handleMetaError(data, res) {
  if (data.error) {
    return res.status(400).json({ error: data.error.message, code: data.error.code })
  }
  return null
}

// ── Health check ──────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', version: META_VERSION, ts: new Date().toISOString() })
})

// ── Meta API proxy endpoints ──────────────────────────────────────────────────

// Validate token / get user identity
app.get('/api/me', async (req, res) => {
  const token = resolveToken(req)
  if (!token) return res.status(401).json({ error: 'Token non fornito' })
  try {
    const data = await metaGet('/me', { fields: 'id,name,email' }, token)
    if (handleMetaError(data, res)) return
    res.json(data)
  } catch {
    res.status(502).json({ error: 'Errore di rete verso Meta' })
  }
})

// List ad accounts accessible by the token
app.get('/api/adaccounts', async (req, res) => {
  const token = resolveToken(req)
  if (!token) return res.status(401).json({ error: 'Token non fornito' })
  try {
    const data = await metaGet('/me/adaccounts', {
      fields: 'id,name,account_status,currency,timezone_name,amount_spent',
      limit: 50,
    }, token)
    if (handleMetaError(data, res)) return
    res.json(data)
  } catch {
    res.status(502).json({ error: 'Errore di rete verso Meta' })
  }
})

// List campaigns for an ad account
// Query param: account_id (e.g. act_123456789)
app.get('/api/campaigns', async (req, res) => {
  const token = resolveToken(req)
  if (!token) return res.status(401).json({ error: 'Token non fornito' })
  const { account_id } = req.query
  if (!account_id) return res.status(400).json({ error: 'account_id obbligatorio' })
  try {
    const data = await metaGet(`/${account_id}/campaigns`, {
      fields: 'id,name,objective,status,daily_budget,lifetime_budget,start_time,stop_time,created_time',
      limit: 100,
    }, token)
    if (handleMetaError(data, res)) return
    res.json(data)
  } catch {
    res.status(502).json({ error: 'Errore di rete verso Meta' })
  }
})

// Create a campaign
// Body: { account_id, name, objective, daily_budget, start_time, stop_time, status }
app.post('/api/campaigns', async (req, res) => {
  const token = resolveToken(req)
  if (!token) return res.status(401).json({ error: 'Token non fornito' })
  const { account_id, name, objective, daily_budget, lifetime_budget, start_time, stop_time, status = 'PAUSED' } = req.body
  if (!account_id || !name || !objective) {
    return res.status(400).json({ error: 'account_id, name, objective obbligatori' })
  }
  try {
    const payload = {
      name,
      objective,
      status,
      special_ad_categories: [],
    }
    if (daily_budget) payload.daily_budget = Math.round(daily_budget * 100) // Meta uses cents
    if (lifetime_budget) payload.lifetime_budget = Math.round(lifetime_budget * 100)
    if (start_time) payload.start_time = start_time
    if (stop_time) payload.stop_time = stop_time

    const data = await metaPost(`/${account_id}/campaigns`, payload, token)
    if (handleMetaError(data, res)) return
    res.json(data)
  } catch {
    res.status(502).json({ error: 'Errore di rete verso Meta' })
  }
})

// Get insights for a campaign
// Query params: date_preset (last_7d, last_30d, last_month, this_month, yesterday, today)
//               time_range: { since, until } via since/until query params
app.get('/api/campaigns/:id/insights', async (req, res) => {
  const token = resolveToken(req)
  if (!token) return res.status(401).json({ error: 'Token non fornito' })
  const { date_preset = 'last_30d', since, until } = req.query
  try {
    const params = {
      fields: 'impressions,reach,clicks,spend,ctr,cpc,cpm,frequency,actions,action_values',
    }
    if (since && until) {
      params.time_range = JSON.stringify({ since, until })
    } else {
      params.date_preset = date_preset
    }
    const data = await metaGet(`/${req.params.id}/insights`, params, token)
    if (handleMetaError(data, res)) return
    res.json(data)
  } catch {
    res.status(502).json({ error: 'Errore di rete verso Meta' })
  }
})

// Account-level insights summary (dashboard totals)
// Query param: account_id, date_preset
app.get('/api/insights', async (req, res) => {
  const token = resolveToken(req)
  if (!token) return res.status(401).json({ error: 'Token non fornito' })
  const { account_id, date_preset = 'last_30d' } = req.query
  if (!account_id) return res.status(400).json({ error: 'account_id obbligatorio' })
  try {
    const data = await metaGet(`/${account_id}/insights`, {
      fields: 'impressions,reach,clicks,spend,actions,action_values',
      date_preset,
      level: 'account',
    }, token)
    if (handleMetaError(data, res)) return
    res.json(data)
  } catch {
    res.status(502).json({ error: 'Errore di rete verso Meta' })
  }
})

// ── Serve Vite frontend (production) ─────────────────────────────────────────

const distDir = path.join(__dirname, '..', 'dist')
app.use(express.static(distDir))
app.get('*', (_req, res) => {
  res.sendFile(path.join(distDir, 'index.html'))
})

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`AdFlow backend running on port ${PORT}`)
  console.log(`Meta API: ${META_BASE}`)
  console.log(`Token source: ${process.env.META_ACCESS_TOKEN ? 'env var' : 'per-request header'}`)
})
