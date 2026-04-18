require('dotenv').config()

const express = require('express')
const cors = require('cors')
const path = require('path')

const app = express()
app.use(express.json({ limit: '15mb' }))

const PORT = process.env.PORT || 3001
const META_VERSION = process.env.META_API_VERSION || 'v19.0'
const META_BASE = `https://graph.facebook.com/${META_VERSION}`

const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:5173')
  .split(',').map(s => s.trim())

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true)
    cb(new Error('Not allowed by CORS'))
  },
  methods: ['GET', 'POST', 'PATCH', 'DELETE'],
}))

function resolveToken(req) {
  return process.env.META_ACCESS_TOKEN || req.headers['x-meta-token'] || ''
}

async function metaGet(metaPath, params, token) {
  const url = new URL(`${META_BASE}${metaPath}`)
  url.searchParams.set('access_token', token)
  for (const [k, v] of Object.entries(params || {})) {
    if (v !== undefined && v !== '') url.searchParams.set(k, String(v))
  }
  const res = await fetch(url.toString())
  return res.json()
}

async function metaPost(metaPath, body, token) {
  const url = new URL(`${META_BASE}${metaPath}`)
  url.searchParams.set('access_token', token)
  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return res.json()
}

function handleMetaError(data, res) {
  if (data && data.error) {
    return res.status(400).json({ error: data.error.message, code: data.error.code })
  }
  return null
}

// ── In-memory rules store ─────────────────────────────────────────────────────
const rulesStore = { rules: [], token: '' }

// ── Health ────────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) =>
  res.json({ status: 'ok', version: META_VERSION, ts: new Date().toISOString() }))

// ── Identity ──────────────────────────────────────────────────────────────────
app.get('/api/me', async (req, res) => {
  const token = resolveToken(req)
  if (!token) return res.status(401).json({ error: 'Token non fornito' })
  try {
    const data = await metaGet('/me', { fields: 'id,name,email' }, token)
    if (handleMetaError(data, res)) return
    res.json(data)
  } catch { res.status(502).json({ error: 'Errore di rete verso Meta' }) }
})

// ── Ad accounts ───────────────────────────────────────────────────────────────
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
  } catch { res.status(502).json({ error: 'Errore di rete verso Meta' }) }
})

// ── Campaigns ─────────────────────────────────────────────────────────────────
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
  } catch { res.status(502).json({ error: 'Errore di rete verso Meta' }) }
})

app.post('/api/campaigns', async (req, res) => {
  const token = resolveToken(req)
  if (!token) return res.status(401).json({ error: 'Token non fornito' })
  const { account_id, name, objective, daily_budget, lifetime_budget, start_time, stop_time, status = 'PAUSED' } = req.body
  if (!account_id || !name || !objective)
    return res.status(400).json({ error: 'account_id, name, objective obbligatori' })
  try {
    const payload = { name, objective, status, special_ad_categories: [] }
    if (daily_budget)    payload.daily_budget    = Math.round(daily_budget * 100)
    if (lifetime_budget) payload.lifetime_budget = Math.round(lifetime_budget * 100)
    if (start_time) payload.start_time = start_time
    if (stop_time)  payload.stop_time  = stop_time
    const data = await metaPost(`/${account_id}/campaigns`, payload, token)
    if (handleMetaError(data, res)) return
    res.json(data)
  } catch { res.status(502).json({ error: 'Errore di rete verso Meta' }) }
})

// Pause / resume campaign
app.patch('/api/campaigns/:id', async (req, res) => {
  const token = resolveToken(req)
  if (!token) return res.status(401).json({ error: 'Token non fornito' })
  const { status } = req.body
  if (!status) return res.status(400).json({ error: 'status obbligatorio' })
  try {
    const url = new URL(`${META_BASE}/${req.params.id}`)
    url.searchParams.set('access_token', token)
    const result = await fetch(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    const data = await result.json()
    if (handleMetaError(data, res)) return
    res.json(data)
  } catch { res.status(502).json({ error: 'Errore di rete verso Meta' }) }
})

// Delete campaign on Meta
app.delete('/api/campaigns/:id', async (req, res) => {
  const token = resolveToken(req)
  if (!token) return res.status(401).json({ error: 'Token non fornito' })
  try {
    const url = new URL(`${META_BASE}/${req.params.id}`)
    url.searchParams.set('access_token', token)
    const result = await fetch(url.toString(), { method: 'DELETE' })
    const data = await result.json()
    if (handleMetaError(data, res)) return
    res.json(data)
  } catch { res.status(502).json({ error: 'Errore di rete verso Meta' }) }
})

// ── Pages ─────────────────────────────────────────────────────────────────────
app.get('/api/pages', async (req, res) => {
  const token = resolveToken(req)
  if (!token) return res.status(401).json({ error: 'Token non fornito' })
  const { account_id } = req.query
  if (!account_id) return res.status(400).json({ error: 'account_id obbligatorio' })
  try {
    const data = await metaGet(`/${account_id}/promote_pages`, {
      fields: 'id,name,category',
      limit: 50,
    }, token)
    if (handleMetaError(data, res)) return
    res.json(data)
  } catch { res.status(502).json({ error: 'Errore di rete verso Meta' }) }
})

// ── Ad images ─────────────────────────────────────────────────────────────────
app.post('/api/adaccounts/:id/adimages', async (req, res) => {
  const token = resolveToken(req)
  if (!token) return res.status(401).json({ error: 'Token non fornito' })
  const { imageBase64, filename = 'creative.jpg' } = req.body
  if (!imageBase64) return res.status(400).json({ error: 'imageBase64 obbligatorio' })
  try {
    const url = new URL(`${META_BASE}/${req.params.id}/adimages`)
    url.searchParams.set('access_token', token)
    const buffer = Buffer.from(imageBase64, 'base64')
    const formData = new FormData()
    formData.append(filename, new Blob([buffer]), filename)
    const result = await fetch(url.toString(), { method: 'POST', body: formData })
    const data = await result.json()
    if (handleMetaError(data, res)) return
    res.json(data)
  } catch { res.status(502).json({ error: 'Errore upload immagine' }) }
})

// ── Ad sets ───────────────────────────────────────────────────────────────────
app.post('/api/adaccounts/:id/adsets', async (req, res) => {
  const token = resolveToken(req)
  if (!token) return res.status(401).json({ error: 'Token non fornito' })
  const {
    campaign_id, name, targeting, daily_budget, lifetime_budget,
    billing_event = 'IMPRESSIONS', optimization_goal,
    bid_strategy = 'LOWEST_COST_WITHOUT_CAP',
    start_time, end_time, status = 'PAUSED',
  } = req.body
  if (!campaign_id || !name || !targeting)
    return res.status(400).json({ error: 'campaign_id, name, targeting obbligatori' })
  try {
    const payload = { campaign_id, name, targeting, billing_event, optimization_goal, bid_strategy, status }
    if (daily_budget)    payload.daily_budget    = Math.round(daily_budget * 100)
    if (lifetime_budget) payload.lifetime_budget = Math.round(lifetime_budget * 100)
    if (start_time) payload.start_time = start_time
    if (end_time)   payload.end_time   = end_time
    const data = await metaPost(`/${req.params.id}/adsets`, payload, token)
    if (handleMetaError(data, res)) return
    res.json(data)
  } catch { res.status(502).json({ error: 'Errore di rete verso Meta' }) }
})

// ── Ad creatives ──────────────────────────────────────────────────────────────
app.post('/api/adaccounts/:id/adcreatives', async (req, res) => {
  const token = resolveToken(req)
  if (!token) return res.status(401).json({ error: 'Token non fornito' })
  const { name, page_id, image_hash, message, link, caption, headline, call_to_action_type = 'LEARN_MORE' } = req.body
  try {
    const payload = {
      name,
      object_story_spec: {
        page_id,
        link_data: {
          image_hash,
          message,
          link,
          name: headline,
          caption,
          call_to_action: { type: call_to_action_type },
        },
      },
    }
    const data = await metaPost(`/${req.params.id}/adcreatives`, payload, token)
    if (handleMetaError(data, res)) return
    res.json(data)
  } catch { res.status(502).json({ error: 'Errore di rete verso Meta' }) }
})

// ── Ads ───────────────────────────────────────────────────────────────────────
app.post('/api/adaccounts/:id/ads', async (req, res) => {
  const token = resolveToken(req)
  if (!token) return res.status(401).json({ error: 'Token non fornito' })
  const { name, adset_id, creative_id, status = 'PAUSED' } = req.body
  try {
    const data = await metaPost(`/${req.params.id}/ads`, {
      name,
      adset_id,
      creative: { creative_id },
      status,
    }, token)
    if (handleMetaError(data, res)) return
    res.json(data)
  } catch { res.status(502).json({ error: 'Errore di rete verso Meta' }) }
})

// ── Insights ──────────────────────────────────────────────────────────────────
app.get('/api/campaigns/:id/insights', async (req, res) => {
  const token = resolveToken(req)
  if (!token) return res.status(401).json({ error: 'Token non fornito' })
  const { date_preset = 'last_30d', since, until } = req.query
  try {
    const params = { fields: 'impressions,reach,clicks,spend,ctr,cpc,cpm,frequency,actions,action_values' }
    if (since && until) params.time_range = JSON.stringify({ since, until })
    else params.date_preset = date_preset
    const data = await metaGet(`/${req.params.id}/insights`, params, token)
    if (handleMetaError(data, res)) return
    res.json(data)
  } catch { res.status(502).json({ error: 'Errore di rete verso Meta' }) }
})

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
  } catch { res.status(502).json({ error: 'Errore di rete verso Meta' }) }
})

// ── Rules ─────────────────────────────────────────────────────────────────────
app.get('/api/rules', (_req, res) => res.json(rulesStore.rules))

app.post('/api/rules', (req, res) => {
  const { rules, token } = req.body
  if (Array.isArray(rules)) rulesStore.rules = rules
  if (token) rulesStore.token = token
  res.json({ ok: true })
})

const CONDITION_FN = {
  cpa_gt:   (v, threshold) => v > threshold,
  roas_gt:  (v, threshold) => v > threshold,
  ctr_lt:   (v, threshold) => v < threshold,
  spend_gt: (v, threshold) => v > threshold,
}

async function executeRules() {
  const active = rulesStore.rules.filter(r => r.on && r.value)
  if (!active.length || !rulesStore.token) return
  console.log(`[Rules] ${new Date().toISOString()} — checking ${active.length} active rules`)

  try {
    // Get all ad accounts accessible by the stored token
    const accountsData = await metaGet('/me/adaccounts', { fields: 'id,name', limit: 50 }, rulesStore.token)
    if (accountsData.error || !accountsData.data) return

    for (const acc of accountsData.data) {
      // Get account-level insights for last 7 days
      const ins = await metaGet(`/${acc.id}/insights`, {
        fields: 'spend,actions,action_values,ctr',
        date_preset: 'last_7d',
        level: 'account',
      }, rulesStore.token)
      const d = ins.data?.[0]
      if (!d) continue

      const spend = parseFloat(d.spend || 0)
      const purchaseAV = (d.action_values || []).find(a => a.action_type === 'purchase')
      const roas = spend > 0 ? parseFloat(purchaseAV?.value || 0) / spend : 0
      const ctr = parseFloat(d.ctr || 0)
      const cpa = spend > 0 ? spend / ((d.actions || []).reduce((s, a) => s + parseInt(a.value || 0), 0) || 1) : 0

      const metricMap = { cpa_gt: cpa, roas_gt: roas, ctr_lt: ctr, spend_gt: spend }

      for (const rule of active) {
        const fn = CONDITION_FN[rule.condition]
        if (!fn) continue
        const metric = metricMap[rule.condition]
        const threshold = parseFloat(rule.value)
        if (fn(metric, threshold)) {
          console.log(`[Rules] "${rule.name}" triggered on ${acc.name} (${rule.condition}: ${metric.toFixed(2)} vs ${threshold})`)
          if (rule.action === 'pause') {
            // Get active campaigns for this account and pause them
            const camps = await metaGet(`/${acc.id}/campaigns`, { fields: 'id,status', limit: 100 }, rulesStore.token)
            for (const c of (camps.data || []).filter(c => c.status === 'ACTIVE')) {
              const url = new URL(`${META_BASE}/${c.id}`)
              url.searchParams.set('access_token', rulesStore.token)
              await fetch(url.toString(), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: 'PAUSED' }),
              })
              console.log(`[Rules] Paused campaign ${c.id} on account ${acc.name}`)
            }
          }
          // budget_increase / budget_decrease / notify → logged only (requires campaign-level budget data)
        }
      }
    }
  } catch (e) {
    console.error('[Rules] Error during execution:', e.message)
  }
}

setInterval(executeRules, 60 * 60 * 1000)

// ── Serve frontend (production) ───────────────────────────────────────────────
const distDir = path.join(__dirname, '..', 'dist')
app.use(express.static(distDir))
app.get('*', (_req, res) => res.sendFile(path.join(distDir, 'index.html')))

app.listen(PORT, () => {
  console.log(`AdFlow backend on port ${PORT}`)
  console.log(`Meta API: ${META_BASE}`)
  console.log(`Token: ${process.env.META_ACCESS_TOKEN ? 'env var' : 'per-request header'}`)
})
