import { useState, useEffect } from 'react'
import './App.css'

const COLORS = ['#6c63ff','#22c55e','#f59e0b','#ef4444','#3b82f6','#ec4899','#14b8a6']
const API = import.meta.env.VITE_API_URL || ''

const STATUS_STYLE = {
  ACTIVE:        { bg: 'rgba(34,197,94,.15)',   color: '#4ade80' },
  PAUSED:        { bg: 'rgba(245,158,11,.15)',  color: '#fbbf24' },
  DELETED:       { bg: 'rgba(239,68,68,.15)',   color: '#f87171' },
  ARCHIVED:      { bg: 'rgba(90,90,120,.2)',    color: '#9090b0' },
  IN_PROCESS:    { bg: 'rgba(59,130,246,.15)',  color: '#60a5fa' },
  WITH_ISSUES:   { bg: 'rgba(239,68,68,.15)',   color: '#f87171' },
  PENDING_REVIEW:{ bg: 'rgba(245,158,11,.15)',  color: '#fbbf24' },
}

const OPT_GOAL = {
  OUTCOME_TRAFFIC:       'LINK_CLICKS',
  OUTCOME_LEADS:         'LEAD_GENERATION',
  OUTCOME_SALES:         'OFFSITE_CONVERSIONS',
  OUTCOME_AWARENESS:     'REACH',
  OUTCOME_ENGAGEMENT:    'POST_ENGAGEMENT',
  OUTCOME_APP_PROMOTION: 'APP_INSTALLS',
}

const PLACEMENT_MAP = {
  facebook_feed:    { publisher_platforms: ['facebook'],             facebook_positions: ['feed'] },
  instagram_feed:   { publisher_platforms: ['instagram'],            instagram_positions: ['stream'] },
  instagram_stories:{ publisher_platforms: ['instagram'],            instagram_positions: ['story'] },
  reels:            { publisher_platforms: ['instagram','facebook'],  instagram_positions: ['reels'], facebook_positions: ['reels'] },
}

function getClients()   { return JSON.parse(localStorage.getItem('adflow_clients')  || '[]') }
function saveClients(c) { localStorage.setItem('adflow_clients',  JSON.stringify(c)) }
function getCampagne()  { return JSON.parse(localStorage.getItem('adflow_campagne') || '[]') }
function saveCampagne(c){ localStorage.setItem('adflow_campagne', JSON.stringify(c)) }
function getSettings()  { return JSON.parse(localStorage.getItem('adflow_settings') || '{}') }
function saveSettings(s){ localStorage.setItem('adflow_settings', JSON.stringify(s)) }
function getRules() {
  const saved = localStorage.getItem('adflow_rules')
  if (saved) return JSON.parse(saved)
  return [
    { id:1, name:'Pausa se CPA > soglia',     desc:'Mette in pausa le campagne se il CPA supera il limite',    on:false, icon:'⏸', color:'rgba(239,68,68,.15)',  condition:'cpa_gt',   value:'',    action:'pause' },
    { id:2, name:'Scala budget se ROAS alto', desc:'Aumenta il budget del 20% se ROAS > 3x per 7 giorni',      on:true,  icon:'📈', color:'rgba(34,197,94,.15)', condition:'roas_gt',  value:'3',   action:'budget_increase' },
    { id:3, name:'Alerta spesa giornaliera',  desc:'Notifica quando la spesa supera il 90% del budget',         on:true,  icon:'💰', color:'rgba(245,158,11,.15)',condition:'spend_gt', value:'',    action:'notify' },
    { id:4, name:'Pausa se CTR < 0.5%',       desc:'Sospende annunci con CTR troppo basso dopo 1000 impression',on:false, icon:'📉', color:'rgba(108,99,255,.15)',condition:'ctr_lt',   value:'0.5', action:'pause' },
  ]
}
function saveRules(r) { localStorage.setItem('adflow_rules', JSON.stringify(r)) }

function buildTargeting(form) {
  const countries = form.paesi.split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
  const targeting = {
    geo_locations: { countries: countries.length ? countries : ['IT'] },
    age_min: parseInt(form.etaMin) || 18,
    age_max: parseInt(form.etaMax) || 65,
  }
  if (form.genere === '1') targeting.genders = [1]
  else if (form.genere === '2') targeting.genders = [2]
  if (form.placement !== 'automatic' && PLACEMENT_MAP[form.placement]) {
    Object.assign(targeting, PLACEMENT_MAP[form.placement])
  }
  return targeting
}

export default function App() {
  const [page, setPage] = useState('dashboard')
  const [clients, setClients] = useState(getClients())
  const [campagne, setCampagne] = useState(getCampagne())
  const [settings, setSettings] = useState(getSettings())
  const [notif, setNotif] = useState('')
  const [showNotif, setShowNotif] = useState(false)
  const [modalClient, setModalClient] = useState(false)
  const [editingClient, setEditingClient] = useState(null)
  const [modalRule, setModalRule] = useState(false)
  const [step, setStep] = useState(1)
  const [tokenVisible, setTokenVisible] = useState(false)
  const [connStatus, setConnStatus] = useState('')
  const [launching, setLaunching] = useState(false)
  const [previewFormat, setPreviewFormat] = useState('fb_feed')
  const [imageFile, setImageFile] = useState(null)
  const [imageBase64, setImageBase64] = useState(null)
  const [imagePreview, setImagePreview] = useState(null)
  const [dashMetrics, setDashMetrics] = useState({ spend: '—', roas: '—' })
  const [clientInsights, setClientInsights] = useState({})
  const [reportLoading, setReportLoading] = useState(null)
  const [rules, setRules] = useState(getRules())

  const [campForm, setCampForm] = useState({
    nome:'', clienteId:'', obiettivo:'OUTCOME_TRAFFIC', formato:'image',
    etaMin:'18', etaMax:'45', genere:'0', paesi:'IT', interessi:'',
    placement:'automatic', adText:'', adHeadline:'', adDesc:'', adUrl:'',
    adCta:'LEARN_MORE', budgetType:'DAILY', budget:'10',
    startDate: new Date().toISOString().split('T')[0], startTime:'00:00',
    endDate:'', noEndDate:false, bidStrategy:'LOWEST_COST_WITHOUT_CAP',
  })

  const [clientForm, setClientForm] = useState({ name:'', adAccount:'', pageId:'', sector:'E-commerce', notes:'' })
  const [settForm, setSettForm] = useState({ agencyName: settings.agencyName||'', email: settings.email||'', token: settings.token||'', bmId: settings.bmId||'', appId: settings.appId||'' })
  const [ruleForm, setRuleForm] = useState({ name:'', condition:'cpa_gt', value:'', action:'pause' })

  // ── Effects ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (settings.token) fetchAllInsights(settings.token)
  }, [settings.token])

  // ── Helpers ────────────────────────────────────────────────────────────────
  function notify(msg) { setNotif(msg); setShowNotif(true); setTimeout(() => setShowNotif(false), 3500) }

  function metaHeaders() {
    const token = settForm.token || settings.token
    return token ? { 'x-meta-token': token } : {}
  }

  // ── Insights ───────────────────────────────────────────────────────────────
  async function fetchAllInsights(token) {
    const allClients = getClients().filter(c => c.adAccount)
    if (!allClients.length) return
    const headers = { 'x-meta-token': token }
    let totalSpend = 0
    let totalPurchaseValue = 0
    const insights = {}
    await Promise.allSettled(allClients.map(async (client) => {
      try {
        const res = await fetch(`${API}/api/insights?account_id=${client.adAccount}&date_preset=last_30d`, { headers })
        const data = await res.json()
        const d = data.data?.[0]
        if (d) {
          const spend = parseFloat(d.spend || 0)
          const purchaseAV = (d.action_values || []).find(a => a.action_type === 'purchase')
          const purchaseValue = parseFloat(purchaseAV?.value || 0)
          totalSpend += spend
          totalPurchaseValue += purchaseValue
          insights[client.id] = {
            spend: spend > 0 ? '€' + spend.toFixed(2) : '—',
            roas: spend > 0 ? (purchaseValue / spend).toFixed(2) + 'x' : '—',
          }
        }
      } catch {}
    }))
    setDashMetrics({
      spend: totalSpend > 0 ? '€' + totalSpend.toFixed(2) : '—',
      roas: totalSpend > 0 ? (totalPurchaseValue / totalSpend).toFixed(2) + 'x' : '—',
    })
    setClientInsights(insights)
  }

  // ── Clients ────────────────────────────────────────────────────────────────
  function saveClient() {
    if (!clientForm.name) { notify('Inserisci il nome del cliente'); return }
    const updated = [...clients, { ...clientForm, id: Date.now().toString(), createdAt: new Date().toISOString() }]
    saveClients(updated); setClients(updated); setModalClient(false)
    setClientForm({ name:'', adAccount:'', pageId:'', sector:'E-commerce', notes:'' })
    notify('Cliente aggiunto!')
  }

  function openEditClient(client) {
    setEditingClient(client)
    setClientForm({ name: client.name, adAccount: client.adAccount||'', pageId: client.pageId||'', sector: client.sector||'E-commerce', notes: client.notes||'' })
  }

  function updateClient() {
    if (!clientForm.name) { notify('Inserisci il nome del cliente'); return }
    const updated = clients.map(c => c.id === editingClient.id ? { ...c, ...clientForm } : c)
    saveClients(updated); setClients(updated); setEditingClient(null)
    setClientForm({ name:'', adAccount:'', pageId:'', sector:'E-commerce', notes:'' })
    notify('Cliente aggiornato!')
  }

  function deleteClient(id) {
    if (!confirm('Eliminare questo cliente?')) return
    const updated = clients.filter(c => c.id !== id)
    saveClients(updated); setClients(updated)
    notify('Cliente eliminato')
  }

  // ── Campaigns ──────────────────────────────────────────────────────────────
  async function toggleCampaign(camp) {
    if (!settings.token) { notify('Token non configurato'); return }
    const newStatus = camp.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE'
    if (camp.fromMeta) {
      try {
        const res = await fetch(`${API}/api/campaigns/${camp.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', ...metaHeaders() },
          body: JSON.stringify({ status: newStatus }),
        })
        const data = await res.json()
        if (data.error) { notify('❌ ' + data.error); return }
      } catch { notify('❌ Errore di rete'); return }
    }
    const updated = campagne.map(c => c.id === camp.id ? { ...c, status: newStatus } : c)
    saveCampagne(updated); setCampagne(updated)
    notify(newStatus === 'ACTIVE' ? '▶ Campagna attivata' : '⏸ Campagna messa in pausa')
  }

  async function deleteCampaign(camp) {
    if (!confirm(`Eliminare la campagna "${camp.nome}"?`)) return
    if (camp.fromMeta && settings.token) {
      try {
        await fetch(`${API}/api/campaigns/${camp.id}`, {
          method: 'DELETE',
          headers: metaHeaders(),
        })
      } catch {}
    }
    const updated = campagne.filter(c => c.id !== camp.id)
    saveCampagne(updated); setCampagne(updated)
    notify('Campagna eliminata')
  }

  // ── Image upload ───────────────────────────────────────────────────────────
  function handleImageSelect(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setImageFile(file)
    const reader = new FileReader()
    reader.onload = (ev) => {
      setImagePreview(ev.target.result)
      setImageBase64(ev.target.result.split(',')[1])
    }
    reader.readAsDataURL(file)
  }

  // ── Launch campaign (full Meta flow) ───────────────────────────────────────
  async function lanciaCampagna() {
    if (!campForm.nome)       { notify('Inserisci il nome della campagna'); return }
    if (!campForm.clienteId)  { notify('Seleziona un cliente'); return }
    if (!settings.token)      { notify('⚠ Token non configurato. Vai in Impostazioni.'); return }
    const client = clients.find(c => c.id === campForm.clienteId)
    if (!client?.adAccount)   { notify('⚠ Il cliente non ha un Ad Account ID configurato'); return }

    setLaunching(true)
    const headers = { 'Content-Type': 'application/json', ...metaHeaders() }

    try {
      // 1 — Campaign
      notify('1/4 Creazione campagna su Meta...')
      const campRes = await fetch(`${API}/api/campaigns`, {
        method: 'POST', headers,
        body: JSON.stringify({
          account_id: client.adAccount,
          name: campForm.nome,
          objective: campForm.obiettivo,
          daily_budget:    campForm.budgetType === 'DAILY'    ? Number(campForm.budget) : undefined,
          lifetime_budget: campForm.budgetType === 'LIFETIME' ? Number(campForm.budget) : undefined,
          start_time: campForm.startDate ? `${campForm.startDate}T${campForm.startTime||'00:00'}:00` : undefined,
          stop_time:  (!campForm.noEndDate && campForm.endDate) ? campForm.endDate : undefined,
          status: 'PAUSED',
        }),
      })
      const campData = await campRes.json()
      if (campData.error) { notify('❌ Campagna: ' + campData.error); setLaunching(false); return }
      const campaignId = campData.id

      // 2 — Ad Set
      notify('2/4 Creazione pubblico e targeting...')
      const targeting = buildTargeting(campForm)
      const adsetBody = {
        campaign_id: campaignId,
        name: campForm.nome + ' – Ad Set',
        targeting,
        billing_event: 'IMPRESSIONS',
        optimization_goal: OPT_GOAL[campForm.obiettivo] || 'LINK_CLICKS',
        bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
        status: 'PAUSED',
      }
      if (campForm.startDate) adsetBody.start_time = campForm.startDate
      if (campForm.endDate)   adsetBody.end_time   = campForm.endDate

      const adsetRes = await fetch(`${API}/api/adaccounts/${client.adAccount}/adsets`, {
        method: 'POST', headers, body: JSON.stringify(adsetBody),
      })
      const adsetData = await adsetRes.json()
      const adsetId = adsetData.id
      if (adsetData.error) notify('⚠ Ad Set: ' + adsetData.error)

      // 3 — Image upload (if provided)
      let imageHash = null
      if (imageBase64 && adsetId) {
        notify('3/4 Upload immagine creativa...')
        try {
          const imgRes = await fetch(`${API}/api/adaccounts/${client.adAccount}/adimages`, {
            method: 'POST', headers,
            body: JSON.stringify({ imageBase64, filename: imageFile?.name || 'creative.jpg' }),
          })
          const imgData = await imgRes.json()
          if (!imgData.error && imgData.images) {
            imageHash = Object.values(imgData.images)[0]?.hash || null
          }
        } catch {}
      }

      // 4 — Creative + Ad (if image, URL and page ID available)
      let adCreated = false
      if (imageHash && campForm.adUrl && client.pageId && adsetId) {
        notify('4/4 Creazione creative e annuncio...')
        try {
          const creativeRes = await fetch(`${API}/api/adaccounts/${client.adAccount}/adcreatives`, {
            method: 'POST', headers,
            body: JSON.stringify({
              name: campForm.nome + ' – Creative',
              page_id: client.pageId,
              image_hash: imageHash,
              message: campForm.adText,
              link: campForm.adUrl,
              headline: campForm.adHeadline,
              caption: campForm.adDesc,
              call_to_action_type: campForm.adCta,
            }),
          })
          const creativeData = await creativeRes.json()
          if (!creativeData.error && creativeData.id) {
            await fetch(`${API}/api/adaccounts/${client.adAccount}/ads`, {
              method: 'POST', headers,
              body: JSON.stringify({
                name: campForm.nome + ' – Ad',
                adset_id: adsetId,
                creative_id: creativeData.id,
                status: 'PAUSED',
              }),
            })
            adCreated = true
          }
        } catch {}
      }

      // Save locally
      const newCamp = {
        ...campForm, id: campaignId,
        clienteName: client.name, status: 'PAUSED',
        createdAt: new Date().toISOString(), fromMeta: true,
        hasAdSet: !!adsetId, hasAd: adCreated,
      }
      const updated = [...campagne, newCamp]
      saveCampagne(updated); setCampagne(updated)

      const msg = adCreated
        ? '✅ Campagna completa creata su Meta!'
        : adsetId
          ? '✅ Campagna + Ad Set creati. Aggiungi un\'immagine per completare l\'annuncio.'
          : '✅ Campagna creata su Meta!'
      notify(msg)
      setImageFile(null); setImageBase64(null); setImagePreview(null)
      setTimeout(() => setPage('campagne'), 1800)
    } catch {
      notify('❌ Errore durante la creazione')
    }
    setLaunching(false)
  }

  // ── Rules ──────────────────────────────────────────────────────────────────
  function saveRule() {
    if (!ruleForm.name) { notify('Inserisci il nome della regola'); return }
    const condLabels = { cpa_gt:'CPA >', roas_gt:'ROAS >', ctr_lt:'CTR <', spend_gt:'Spesa >' }
    const actLabels  = { pause:'Metti in pausa', budget_increase:'Aumenta budget 20%', budget_decrease:'Riduci budget 20%', notify:'Solo notifica' }
    const newRules = [...rules, {
      id: Date.now(), name: ruleForm.name, on: false, icon: '⚡', color: 'rgba(108,99,255,.15)',
      desc: `${condLabels[ruleForm.condition]} ${ruleForm.value} → ${actLabels[ruleForm.action]}`,
      condition: ruleForm.condition, value: ruleForm.value, action: ruleForm.action,
    }]
    setRules(newRules); saveRules(newRules)
    syncRulesToBackend(newRules)
    setModalRule(false); setRuleForm({ name:'', condition:'cpa_gt', value:'', action:'pause' })
    notify('Regola aggiunta!')
  }

  function toggleRule(id) {
    const updated = rules.map(r => r.id === id ? { ...r, on: !r.on } : r)
    setRules(updated); saveRules(updated)
    syncRulesToBackend(updated)
  }

  function deleteRule(id) {
    if (!confirm('Eliminare questa regola?')) return
    const updated = rules.filter(r => r.id !== id)
    setRules(updated); saveRules(updated)
    syncRulesToBackend(updated)
    notify('Regola eliminata')
  }

  function syncRulesToBackend(r) {
    const token = settings.token || settForm.token
    if (!token) return
    fetch(`${API}/api/rules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rules: r, token }),
    }).catch(() => {})
  }

  // ── Reports ────────────────────────────────────────────────────────────────
  async function generateReport(type) {
    if (!settings.token) { notify('Configura prima il token API'); return }
    setReportLoading(type)
    const date_preset = type === 'settimanale' ? 'last_7d' : 'last_30d'
    try {
      const headers = metaHeaders()
      const accountsRes = await fetch(`${API}/api/adaccounts`, { headers })
      const accountsData = await accountsRes.json()
      if (accountsData.error) { notify('❌ ' + accountsData.error); setReportLoading(null); return }
      const rows = []
      await Promise.allSettled((accountsData.data || []).map(async (acc) => {
        const insRes = await fetch(`${API}/api/insights?account_id=${acc.id}&date_preset=${date_preset}`, { headers })
        const insData = await insRes.json()
        const d = insData.data?.[0] || {}
        const spend = parseFloat(d.spend || 0)
        const purchaseAV = (d.action_values || []).find(a => a.action_type === 'purchase')
        const purchaseValue = parseFloat(purchaseAV?.value || 0)
        const roas = spend > 0 ? (purchaseValue / spend).toFixed(2) : '—'
        rows.push({
          account: acc.name,
          spend: spend.toFixed(2),
          impressions: d.impressions || 0,
          clicks: d.clicks || 0,
          ctr: d.ctr ? parseFloat(d.ctr).toFixed(2) + '%' : '—',
          roas,
        })
      }))
      const period = type === 'settimanale' ? 'last_7d' : type === 'mensile' ? 'last_30d' : 'per_cliente'
      const csv = [
        'Account,Spesa (€),Impression,Click,CTR,ROAS',
        ...rows.map(r => `"${r.account}",${r.spend},${r.impressions},${r.clicks},${r.ctr},${r.roas}`),
      ].join('\n')
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `adflow-report-${period}-${new Date().toISOString().split('T')[0]}.csv`
      a.click()
      notify('✅ Report CSV scaricato!')
    } catch { notify('❌ Errore generazione report') }
    setReportLoading(null)
  }

  // ── Settings ───────────────────────────────────────────────────────────────
  function saveSettingsForm() {
    saveSettings(settForm); setSettings(settForm)
    syncRulesToBackend(rules)
    notify('Impostazioni salvate!')
    if (settForm.token) fetchAllInsights(settForm.token)
  }

  function testConnection() {
    if (!settForm.token) { notify('Inserisci prima il token'); return }
    setConnStatus('Verifica in corso...')
    fetch(`${API}/api/me`, { headers: { 'x-meta-token': settForm.token } })
      .then(r => r.json())
      .then(d => {
        if (d.id) { setConnStatus('✅ Connesso: ' + (d.name || d.id)); notify('Connessione riuscita!') }
        else { setConnStatus('❌ ' + (d.error || 'Token non valido')) }
      })
      .catch(() => setConnStatus('⚠ Backend non raggiungibile'))
  }

  function syncCampaigns() {
    if (!settings.token) { notify('⚠ Configura prima il token nelle Impostazioni'); return }
    notify('Sincronizzazione campagne in corso...')
    const headers = metaHeaders()
    fetch(`${API}/api/adaccounts`, { headers })
      .then(r => r.json())
      .then(async accountsData => {
        if (accountsData.error) { notify('❌ ' + accountsData.error); return }
        const accounts = accountsData.data || []
        if (!accounts.length) { notify('Nessun ad account trovato'); return }
        const allCampaigns = []
        await Promise.all(accounts.map(async acc => {
          const res = await fetch(`${API}/api/campaigns?account_id=${acc.id}`, { headers })
          const json = await res.json()
          if (json.data) {
            json.data.forEach(c => allCampaigns.push({
              id: c.id, nome: c.name, clienteId: '', clienteName: acc.name,
              obiettivo: c.objective, status: c.status,
              budget: c.daily_budget ? Math.round(c.daily_budget / 100) : '—',
              budgetType: c.daily_budget ? 'DAILY' : 'LIFETIME',
              startDate: c.start_time?.split('T')[0] || '',
              endDate: c.stop_time?.split('T')[0] || '',
              formato: 'image', createdAt: c.created_time, fromMeta: true,
            }))
          }
        }))
        const local = getCampagne().filter(c => !c.fromMeta)
        const merged = [...local, ...allCampaigns]
        saveCampagne(merged); setCampagne(merged)
        notify(`✅ ${allCampaigns.length} campagne sincronizzate da Meta`)
      })
      .catch(() => notify('❌ Errore durante la sincronizzazione'))
  }

  // ── Data ───────────────────────────────────────────────────────────────────
  const objOptions = [
    { val:'OUTCOME_TRAFFIC',       label:'Traffico',   icon:'🎯' },
    { val:'OUTCOME_LEADS',         label:'Lead',       icon:'🧲' },
    { val:'OUTCOME_SALES',         label:'Vendite',    icon:'💰' },
    { val:'OUTCOME_AWARENESS',     label:'Awareness',  icon:'📢' },
    { val:'OUTCOME_ENGAGEMENT',    label:'Engagement', icon:'❤️' },
    { val:'OUTCOME_APP_PROMOTION', label:'App',        icon:'📱' },
  ]
  const fmtOptions = [
    { val:'image',      label:'Immagine',  icon:'🖼️' },
    { val:'video',      label:'Video',     icon:'🎬' },
    { val:'carousel',   label:'Carosello', icon:'🎠' },
    { val:'collection', label:'Collection',icon:'📦' },
  ]
  const navItems = [
    { id:'dashboard',    label:'Dashboard',       icon:'⊞' },
    { id:'clienti',      label:'Clienti',         icon:'👥' },
    { id:'campagne',     label:'Campagne',         icon:'→' },
    { id:'crea',         label:'Nuova Campagna',   icon:'+' },
    { id:'regole',       label:'Regole Auto',      icon:'≡' },
    { id:'report',       label:'Report',           icon:'📄' },
    { id:'impostazioni', label:'Impostazioni',     icon:'⚙' },
  ]

  const inputStyle = { width:'100%', background:'#1a1a24', border:'1px solid #2a2a38', borderRadius:8, padding:'9px 12px', fontSize:13, color:'#f0f0f8', fontFamily:'DM Sans,sans-serif' }
  const monoInputStyle = { ...inputStyle, fontFamily:'monospace' }
  const btnPrimary = { padding:'7px 16px', borderRadius:8, background:'#6c63ff', color:'white', border:'none', fontSize:12, cursor:'pointer', fontFamily:'DM Sans,sans-serif' }
  const btnSecondary = { padding:'7px 16px', borderRadius:8, background:'#1a1a24', color:'#9090b0', border:'1px solid #2a2a38', fontSize:12, cursor:'pointer', fontFamily:'DM Sans,sans-serif' }
  const btnDanger = { padding:'5px 10px', borderRadius:6, background:'rgba(239,68,68,.1)', color:'#f87171', border:'1px solid rgba(239,68,68,.3)', fontSize:11, cursor:'pointer', fontFamily:'DM Sans,sans-serif' }
  const helpText = { fontSize:11, color:'#5a5a78', marginTop:5, lineHeight:1.5 }

  // ── Status badge ───────────────────────────────────────────────────────────
  function StatusBadge({ status }) {
    const s = STATUS_STYLE[status] || STATUS_STYLE.ARCHIVED
    return <span style={{ padding:'3px 8px', borderRadius:20, fontSize:11, background:s.bg, color:s.color }}>● {status}</span>
  }

  return (
    <div style={{display:'flex',minHeight:'100vh',background:'#0a0a0f',color:'#f0f0f8',fontFamily:'DM Sans,sans-serif'}}>

      {/* SIDEBAR */}
      <aside style={{width:220,background:'#111118',borderRight:'1px solid #2a2a38',display:'flex',flexDirection:'column'}}>
        <div style={{padding:'20px 20px 16px',borderBottom:'1px solid #2a2a38'}}>
          <div style={{fontFamily:'Syne,sans-serif',fontSize:20,fontWeight:800}}>Ad<span style={{color:'#8b85ff'}}>Flow</span></div>
          <div style={{fontSize:11,color:'#5a5a78',marginTop:2}}>Agency Ads Platform</div>
        </div>
        <nav style={{padding:'12px 10px',flex:1}}>
          {navItems.map(n => (
            <button key={n.id} onClick={() => setPage(n.id)} style={{display:'flex',alignItems:'center',gap:10,padding:'9px 10px',borderRadius:8,cursor:'pointer',fontSize:13,color:page===n.id?'#8b85ff':'#9090b0',background:page===n.id?'rgba(108,99,255,.15)':'none',border:'none',width:'100%',textAlign:'left',marginBottom:2,fontFamily:'DM Sans,sans-serif'}}>
              <span style={{fontSize:14,opacity:.8}}>{n.icon}</span>{n.label}
            </button>
          ))}
        </nav>
        <div style={{padding:'12px 10px',borderTop:'1px solid #2a2a38'}}>
          <div style={{display:'flex',alignItems:'center',gap:10,padding:10,background:'#1a1a24',borderRadius:8,fontSize:13}}>
            <div style={{width:28,height:28,borderRadius:6,background:'#3d37cc',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:700,flexShrink:0}}>{(settings.agencyName||'A').charAt(0).toUpperCase()}</div>
            <div>
              <div style={{fontSize:12,fontWeight:500}}>{settings.agencyName||'La mia Agenzia'}</div>
              <div style={{fontSize:10,color:settings.token?'#22c55e':'#5a5a78'}}>{settings.token?'● Token configurato':'● Token mancante'}</div>
            </div>
          </div>
        </div>
      </aside>

      {/* MAIN */}
      <main style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>
        <div style={{padding:'16px 24px',borderBottom:'1px solid #2a2a38',background:'#111118',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          <div style={{fontFamily:'Syne,sans-serif',fontSize:18,fontWeight:700}}>{navItems.find(n=>n.id===page)?.label}</div>
          <div style={{display:'flex',gap:8}}>
            <button onClick={() => setPage('impostazioni')} style={btnSecondary}>⚙ Token</button>
            <button onClick={() => { setPage('crea'); setStep(1) }} style={btnPrimary}>+ Nuova Campagna</button>
          </div>
        </div>

        <div style={{flex:1,overflowY:'auto',padding:24}}>

          {/* ── DASHBOARD ─────────────────────────────────────────────────── */}
          {page==='dashboard' && (
            <div>
              {!settings.token && <div style={{padding:'12px 16px',background:'rgba(245,158,11,.1)',border:'1px solid rgba(245,158,11,.3)',borderRadius:8,color:'#fbbf24',fontSize:13,marginBottom:20}}>⚠ Token API non configurato. Vai in <strong>Impostazioni</strong> per iniziare.</div>}
              <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:24}}>
                {[
                  { label:'Spesa Totale (30gg)',  val: dashMetrics.spend },
                  { label:'ROAS Medio (30gg)',    val: dashMetrics.roas  },
                  { label:'Campagne Attive',      val: campagne.filter(c=>c.status==='ACTIVE').length },
                  { label:'Clienti',              val: clients.length },
                ].map((s,i) => (
                  <div key={i} style={{background:'#111118',border:'1px solid #2a2a38',borderRadius:12,padding:'16px 18px'}}>
                    <div style={{fontSize:11,color:'#5a5a78',textTransform:'uppercase',letterSpacing:.5,marginBottom:8}}>{s.label}</div>
                    <div style={{fontSize:24,fontWeight:600,fontFamily:'Syne,sans-serif'}}>{s.val}</div>
                  </div>
                ))}
              </div>
              <div style={{background:'#111118',border:'1px solid #2a2a38',borderRadius:12,padding:20}}>
                <div style={{fontSize:14,fontWeight:600,marginBottom:16}}>Come iniziare</div>
                <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:16}}>
                  {[{n:1,t:'Configura il Token',d:'Inserisci il System User Token in Impostazioni'},{n:2,t:'Aggiungi Clienti',d:'Collega gli ad account dei tuoi clienti'},{n:3,t:'Lancia Campagne',d:'Crea campagne senza toccare Facebook'}].map(s => (
                    <div key={s.n} style={{textAlign:'center',padding:16}}>
                      <div style={{width:40,height:40,borderRadius:'50%',background:'rgba(108,99,255,.15)',display:'flex',alignItems:'center',justifyContent:'center',margin:'0 auto 10px',fontSize:16,fontWeight:700,color:'#8b85ff'}}>{s.n}</div>
                      <div style={{fontSize:13,fontWeight:500,marginBottom:4}}>{s.t}</div>
                      <div style={{fontSize:11,color:'#5a5a78'}}>{s.d}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── CLIENTI ───────────────────────────────────────────────────── */}
          {page==='clienti' && (
            <div>
              <div style={{display:'flex',justifyContent:'flex-end',marginBottom:16}}>
                <button onClick={() => setModalClient(true)} style={btnPrimary}>+ Aggiungi Cliente</button>
              </div>
              {clients.length === 0 ? (
                <div style={{textAlign:'center',padding:60,color:'#5a5a78'}}>
                  <div style={{fontSize:40,marginBottom:12}}>🏢</div>
                  <div style={{fontSize:13}}>Nessun cliente. Clicca "Aggiungi Cliente" per iniziare.</div>
                </div>
              ) : (
                <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:12}}>
                  {clients.map((c,i) => (
                    <div key={c.id} style={{background:'#111118',border:'1px solid #2a2a38',borderRadius:12,padding:16}}>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:10}}>
                        <div style={{width:40,height:40,borderRadius:10,background:COLORS[i%COLORS.length]+'22',color:COLORS[i%COLORS.length],display:'flex',alignItems:'center',justifyContent:'center',fontSize:14,fontWeight:700}}>{c.name.substring(0,2).toUpperCase()}</div>
                        <div style={{display:'flex',gap:6}}>
                          <button onClick={() => openEditClient(c)} style={{...btnSecondary,padding:'4px 8px',fontSize:11}}>✏ Modifica</button>
                          <button onClick={() => deleteClient(c.id)} style={btnDanger}>✕</button>
                        </div>
                      </div>
                      <div style={{fontSize:14,fontWeight:600}}>{c.name}</div>
                      <div style={{fontSize:11,color:'#5a5a78',marginTop:2}}>{c.sector} • {c.adAccount||'No Ad Account'}</div>
                      <div style={{display:'flex',gap:12,marginTop:12,paddingTop:12,borderTop:'1px solid #2a2a38'}}>
                        <div style={{fontSize:11,color:'#9090b0'}}><strong style={{display:'block',fontSize:13,color:'#f0f0f8'}}>{clientInsights[c.id]?.spend || '—'}</strong>Spesa</div>
                        <div style={{fontSize:11,color:'#9090b0'}}><strong style={{display:'block',fontSize:13,color:'#f0f0f8'}}>{clientInsights[c.id]?.roas  || '—'}</strong>ROAS</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── CAMPAGNE ──────────────────────────────────────────────────── */}
          {page==='campagne' && (
            <div style={{background:'#111118',border:'1px solid #2a2a38',borderRadius:12,overflow:'hidden'}}>
              <div style={{padding:'16px 20px',borderBottom:'1px solid #2a2a38',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                <div style={{fontSize:14,fontWeight:600}}>Tutte le Campagne <span style={{color:'#5a5a78',fontWeight:400,fontSize:12}}>({campagne.length})</span></div>
                <div style={{display:'flex',gap:8}}>
                  <button onClick={syncCampaigns} style={btnSecondary}>⟳ Sync Meta</button>
                  <button onClick={() => { setPage('crea'); setStep(1) }} style={btnPrimary}>+ Nuova</button>
                </div>
              </div>
              {campagne.length === 0 ? (
                <div style={{textAlign:'center',padding:60,color:'#5a5a78'}}><div style={{fontSize:40,marginBottom:12}}>🚀</div><div style={{fontSize:13}}>Nessuna campagna ancora.</div></div>
              ) : (
                <table style={{width:'100%',borderCollapse:'collapse'}}>
                  <thead><tr>{['Campagna','Cliente','Obiettivo','Budget','Stato','Azioni'].map(h => <th key={h} style={{fontSize:11,color:'#5a5a78',textTransform:'uppercase',letterSpacing:.5,padding:'10px 16px',textAlign:'left',borderBottom:'1px solid #2a2a38'}}>{h}</th>)}</tr></thead>
                  <tbody>{campagne.map(c => (
                    <tr key={c.id} style={{borderBottom:'1px solid #1a1a24'}}>
                      <td style={{padding:'12px 16px',fontSize:13,fontWeight:500}}>
                        {c.nome}
                        {c.hasAd && <span style={{marginLeft:6,fontSize:10,color:'#22c55e',background:'rgba(34,197,94,.1)',padding:'1px 5px',borderRadius:4}}>completa</span>}
                        {c.hasAdSet && !c.hasAd && <span style={{marginLeft:6,fontSize:10,color:'#fbbf24',background:'rgba(245,158,11,.1)',padding:'1px 5px',borderRadius:4}}>no annuncio</span>}
                      </td>
                      <td style={{padding:'12px 16px',fontSize:13,color:'#9090b0'}}>{c.clienteName}</td>
                      <td style={{padding:'12px 16px',fontSize:13,color:'#9090b0'}}>{c.obiettivo?.replace('OUTCOME_','')}</td>
                      <td style={{padding:'12px 16px',fontSize:13}}>€{c.budget}{c.budgetType==='DAILY'?'/g':' tot'}</td>
                      <td style={{padding:'12px 16px'}}><StatusBadge status={c.status||'PAUSED'} /></td>
                      <td style={{padding:'12px 16px'}}>
                        <div style={{display:'flex',gap:6}}>
                          <button
                            onClick={() => toggleCampaign(c)}
                            style={{...btnSecondary,padding:'4px 10px',fontSize:11}}
                          >{c.status==='ACTIVE'?'⏸ Pausa':'▶ Attiva'}</button>
                          <button onClick={() => deleteCampaign(c)} style={btnDanger}>✕</button>
                        </div>
                      </td>
                    </tr>
                  ))}</tbody>
                </table>
              )}
            </div>
          )}

          {/* ── CREA CAMPAGNA ─────────────────────────────────────────────── */}
          {page==='crea' && (
            <div>
              {/* Stepper */}
              <div style={{display:'flex',alignItems:'center',gap:0,marginBottom:28}}>
                {[1,2,3,4,5].map((s,i) => (
                  <div key={s} style={{display:'flex',alignItems:'center'}}>
                    <div style={{display:'flex',alignItems:'center',gap:8,fontSize:12,color:step===s?'#8b85ff':step>s?'#22c55e':'#5a5a78'}}>
                      <div style={{width:24,height:24,borderRadius:'50%',border:'1.5px solid currentColor',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:600}}>{step>s?'✓':s}</div>
                      {['Obiettivo','Pubblico','Creatività','Budget','Lancio'][i]}
                    </div>
                    {i<4 && <div style={{flex:1,height:1,background:'#2a2a38',margin:'0 8px',width:30}}></div>}
                  </div>
                ))}
              </div>

              <div style={{background:'#111118',border:'1px solid #2a2a38',borderRadius:12,padding:20,marginBottom:16}}>

                {/* Step 1 — Obiettivo */}
                {step===1 && (
                  <div>
                    <div style={{fontSize:14,fontWeight:600,marginBottom:16}}>Obiettivo della Campagna</div>
                    <div style={{marginBottom:14}}>
                      <label style={{fontSize:12,color:'#9090b0',display:'block',marginBottom:6}}>Nome Campagna</label>
                      <input value={campForm.nome} onChange={e=>setCampForm({...campForm,nome:e.target.value})} placeholder="es. Offerta Estate 2025" style={inputStyle} />
                    </div>
                    <div style={{marginBottom:14}}>
                      <label style={{fontSize:12,color:'#9090b0',display:'block',marginBottom:6}}>Cliente</label>
                      <select value={campForm.clienteId} onChange={e=>setCampForm({...campForm,clienteId:e.target.value})} style={inputStyle}>
                        <option value="">— Seleziona cliente —</option>
                        {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </div>
                    <label style={{fontSize:12,color:'#9090b0',display:'block',marginBottom:8}}>Obiettivo</label>
                    <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:8}}>
                      {objOptions.map(o => (
                        <div key={o.val} onClick={() => setCampForm({...campForm,obiettivo:o.val})} style={{padding:12,background:campForm.obiettivo===o.val?'rgba(108,99,255,.15)':'#1a1a24',border:campForm.obiettivo===o.val?'1px solid #6c63ff':'1px solid #2a2a38',borderRadius:8,cursor:'pointer',textAlign:'center'}}>
                          <div style={{fontSize:20,marginBottom:4}}>{o.icon}</div>
                          <div style={{fontSize:12,fontWeight:500}}>{o.label}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Step 2 — Pubblico */}
                {step===2 && (
                  <div>
                    <div style={{fontSize:14,fontWeight:600,marginBottom:16}}>Definisci il Pubblico</div>
                    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
                      {[{label:'Età minima',key:'etaMin',type:'number'},{label:'Età massima',key:'etaMax',type:'number'},{label:'Paesi (es. IT,DE)',key:'paesi',type:'text'},{label:'Interessi',key:'interessi',type:'text'}].map(f => (
                        <div key={f.key}>
                          <label style={{fontSize:12,color:'#9090b0',display:'block',marginBottom:6}}>{f.label}</label>
                          <input type={f.type} value={campForm[f.key]} onChange={e=>setCampForm({...campForm,[f.key]:e.target.value})} style={inputStyle} />
                        </div>
                      ))}
                    </div>
                    <div style={{marginTop:12}}>
                      <label style={{fontSize:12,color:'#9090b0',display:'block',marginBottom:6}}>Genere</label>
                      <select value={campForm.genere} onChange={e=>setCampForm({...campForm,genere:e.target.value})} style={inputStyle}>
                        <option value="0">Tutti</option>
                        <option value="1">Solo uomini</option>
                        <option value="2">Solo donne</option>
                      </select>
                    </div>
                    <div style={{marginTop:12}}>
                      <label style={{fontSize:12,color:'#9090b0',display:'block',marginBottom:6}}>Posizionamenti</label>
                      <select value={campForm.placement} onChange={e=>setCampForm({...campForm,placement:e.target.value})} style={inputStyle}>
                        <option value="automatic">Automatico (consigliato)</option>
                        <option value="facebook_feed">Solo Feed Facebook</option>
                        <option value="instagram_feed">Solo Feed Instagram</option>
                        <option value="instagram_stories">Solo Stories Instagram</option>
                        <option value="reels">Solo Reels</option>
                      </select>
                    </div>
                  </div>
                )}

                {/* Step 3 — Creatività */}
                {step===3 && (
                  <div>
                    <div style={{fontSize:14,fontWeight:600,marginBottom:16}}>Creatività dell'Annuncio</div>
                    <label style={{fontSize:12,color:'#9090b0',display:'block',marginBottom:8}}>Formato</label>
                    <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:8,marginBottom:16}}>
                      {fmtOptions.map(f => (
                        <div key={f.val} onClick={() => setCampForm({...campForm,formato:f.val})} style={{padding:10,background:campForm.formato===f.val?'rgba(108,99,255,.15)':'#1a1a24',border:campForm.formato===f.val?'1px solid #6c63ff':'1px solid #2a2a38',borderRadius:8,cursor:'pointer',textAlign:'center'}}>
                          <div style={{fontSize:16,marginBottom:3}}>{f.icon}</div>
                          <div style={{fontSize:11}}>{f.label}</div>
                        </div>
                      ))}
                    </div>

                    {/* Image upload */}
                    <div style={{marginBottom:14}}>
                      <label style={{fontSize:12,color:'#9090b0',display:'block',marginBottom:6}}>Immagine creativa</label>
                      <label style={{display:'block',border:'1px dashed #3a3a5e',borderRadius:8,padding:imagePreview?0:20,textAlign:'center',cursor:'pointer',background:'#1a1a24',overflow:'hidden'}}>
                        {imagePreview
                          ? <div style={{display:'flex',alignItems:'center',justifyContent:'center',padding:8,minHeight:80}}>
                              <img src={imagePreview} alt="preview" style={{maxWidth:200,maxHeight:200,objectFit:'contain',borderRadius:6,display:'block'}} />
                            </div>
                          : <div style={{color:'#5a5a78',fontSize:12}}>
                              <div style={{fontSize:24,marginBottom:6}}>🖼️</div>
                              Clicca per caricare un'immagine (JPG, PNG — max 8 MB)
                            </div>
                        }
                        <input type="file" accept="image/*" onChange={handleImageSelect} style={{display:'none'}} />
                      </label>
                      {imagePreview && <button onClick={() => { setImageFile(null); setImageBase64(null); setImagePreview(null) }} style={{...btnDanger,marginTop:6,fontSize:11}}>✕ Rimuovi immagine</button>}
                      <div style={helpText}>Obbligatoria per creare l'annuncio completo su Meta. Dimensione consigliata: 1200×628 px.</div>
                    </div>

                    {[{label:'Testo principale',key:'adText',tag:'textarea'},{label:'Titolo (Headline)',key:'adHeadline'},{label:'Descrizione',key:'adDesc'},{label:'URL di destinazione',key:'adUrl'}].map(f => (
                      <div key={f.key} style={{marginBottom:12}}>
                        <label style={{fontSize:12,color:'#9090b0',display:'block',marginBottom:6}}>{f.label}</label>
                        {f.tag==='textarea'
                          ? <textarea value={campForm[f.key]} onChange={e=>setCampForm({...campForm,[f.key]:e.target.value})} style={{...inputStyle,minHeight:70,resize:'vertical'}} />
                          : <input value={campForm[f.key]} onChange={e=>setCampForm({...campForm,[f.key]:e.target.value})} style={inputStyle} />
                        }
                      </div>
                    ))}
                    <label style={{fontSize:12,color:'#9090b0',display:'block',marginBottom:6}}>Call to Action</label>
                    <select value={campForm.adCta} onChange={e=>setCampForm({...campForm,adCta:e.target.value})} style={inputStyle}>
                      <option value="LEARN_MORE">Scopri di più</option>
                      <option value="SHOP_NOW">Acquista ora</option>
                      <option value="SIGN_UP">Iscriviti</option>
                      <option value="CONTACT_US">Contattaci</option>
                      <option value="GET_QUOTE">Richiedi preventivo</option>
                      <option value="BOOK_NOW">Prenota ora</option>
                    </select>
                  </div>
                )}

                {/* Step 4 — Budget */}
                {step===4 && (
                  <div>
                    <div style={{fontSize:14,fontWeight:600,marginBottom:16}}>Budget e Schedulazione</div>
                    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:12}}>
                      <div>
                        <label style={{fontSize:12,color:'#9090b0',display:'block',marginBottom:6}}>Tipo budget</label>
                        <select value={campForm.budgetType} onChange={e=>setCampForm({...campForm,budgetType:e.target.value})} style={inputStyle}>
                          <option value="DAILY">Giornaliero</option>
                          <option value="LIFETIME">Totale</option>
                        </select>
                      </div>
                      <div>
                        <label style={{fontSize:12,color:'#9090b0',display:'block',marginBottom:6}}>Importo (€)</label>
                        <input type="number" value={campForm.budget} onChange={e=>setCampForm({...campForm,budget:e.target.value})} style={inputStyle} />
                      </div>
                    </div>
                    <div style={{display:'grid',gridTemplateColumns:'1fr auto',gap:8,marginBottom:12,alignItems:'end'}}>
                      <div>
                        <label style={{fontSize:12,color:'#9090b0',display:'block',marginBottom:6}}>Data inizio</label>
                        <input type="date" value={campForm.startDate} onChange={e=>setCampForm({...campForm,startDate:e.target.value})} style={inputStyle} />
                      </div>
                      <div>
                        <label style={{fontSize:12,color:'#9090b0',display:'block',marginBottom:6}}>Orario</label>
                        <input type="time" value={campForm.startTime} onChange={e=>setCampForm({...campForm,startTime:e.target.value})} style={{...inputStyle,width:100}} />
                      </div>
                    </div>
                    <div>
                      <label style={{fontSize:12,color:'#9090b0',display:'block',marginBottom:6}}>Data fine</label>
                      <input
                        type="date"
                        value={campForm.endDate}
                        disabled={campForm.noEndDate}
                        onChange={e=>setCampForm({...campForm,endDate:e.target.value})}
                        style={{...inputStyle,opacity:campForm.noEndDate?.5:1,marginBottom:8}}
                      />
                      <label style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer',fontSize:12,color:'#9090b0'}}>
                        <input
                          type="checkbox"
                          checked={campForm.noEndDate}
                          onChange={e=>setCampForm({...campForm,noEndDate:e.target.checked,endDate:e.target.checked?'':campForm.endDate})}
                          style={{accentColor:'#6c63ff',width:14,height:14}}
                        />
                        Nessuna data di fine (campagna continua)
                      </label>
                    </div>
                  </div>
                )}

                {/* Step 5 — Lancio */}
                {step===5 && (() => {
                  const ctaLabels = { LEARN_MORE:'Scopri di più', SHOP_NOW:'Acquista ora', SIGN_UP:'Iscriviti', CONTACT_US:'Contattaci', GET_QUOTE:'Richiedi preventivo', BOOK_NOW:'Prenota ora' }
                  const adClient = clients.find(c=>c.id===campForm.clienteId)
                  const pageName = adClient?.name || campForm.nome || 'La tua Pagina'
                  const displayUrl = campForm.adUrl ? campForm.adUrl.replace(/^https?:\/\//,'').split('/')[0].toUpperCase() : ''
                  const adText    = campForm.adText     || null
                  const headline  = campForm.adHeadline || null
                  const adDesc    = campForm.adDesc     || null
                  const ctaLabel  = ctaLabels[campForm.adCta] || 'Scopri di più'
                  const ph = (txt) => <span style={{color:'#bec3c9',fontStyle:'italic'}}>{txt}</span>
                  const fmtTabs = [
                    { id:'fb_feed',   label:'Feed Facebook',      icon:'f' },
                    { id:'ig_stories',label:'Stories Instagram',   icon:'▲' },
                    { id:'ig_feed',   label:'Feed Instagram',      icon:'◻' },
                  ]

                  const FbFeedPreview = () => (
                    <div style={{background:'#fff',borderRadius:10,overflow:'hidden',width:360,boxShadow:'0 2px 16px rgba(0,0,0,.45)',color:'#1c1e21',fontFamily:'Helvetica Neue,Arial,sans-serif'}}>
                      <div style={{display:'flex',alignItems:'center',gap:8,padding:'10px 12px'}}>
                        <div style={{width:36,height:36,borderRadius:'50%',background:'#1877f2',display:'flex',alignItems:'center',justifyContent:'center',color:'white',fontSize:13,fontWeight:700,flexShrink:0}}>{pageName.charAt(0).toUpperCase()}</div>
                        <div style={{flex:1}}>
                          <div style={{fontSize:13,fontWeight:700,color:'#050505'}}>{pageName}</div>
                          <div style={{fontSize:11,color:'#65676b'}}>Sponsorizzato · 🌐</div>
                        </div>
                        <div style={{fontSize:18,color:'#65676b',letterSpacing:2}}>···</div>
                      </div>
                      <div style={{padding:'0 12px 10px',fontSize:13,color:'#050505',lineHeight:1.5}}>{adText || ph('Testo principale dell\'annuncio…')}</div>
                      {imagePreview
                        ? <img src={imagePreview} alt="ad" style={{width:'100%',height:300,objectFit:'cover',display:'block'}} />
                        : <div style={{height:300,background:'#e4e6ea',display:'flex',alignItems:'center',justifyContent:'center',fontSize:32,color:'#bec3c9'}}>🖼️</div>
                      }
                      <div style={{background:'#f0f2f5',padding:'8px 12px',display:'flex',alignItems:'center',gap:8}}>
                        <div style={{flex:1,minWidth:0}}>
                          {displayUrl ? <div style={{fontSize:11,color:'#65676b',marginBottom:1,textTransform:'uppercase',letterSpacing:.3,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{displayUrl}</div> : ph('TUOSITO.COM')}
                          <div style={{fontSize:13,fontWeight:700,color:'#050505',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{headline || ph('Headline dell\'annuncio')}</div>
                          {adDesc && <div style={{fontSize:12,color:'#65676b',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{adDesc}</div>}
                        </div>
                        <button style={{padding:'6px 10px',background:'#e4e6ea',border:'none',borderRadius:6,fontSize:12,fontWeight:600,color:'#050505',cursor:'default',flexShrink:0,whiteSpace:'nowrap'}}>{ctaLabel}</button>
                      </div>
                      <div style={{padding:'6px 12px',borderTop:'1px solid #e4e6eb',display:'flex',gap:14,fontSize:12,color:'#65676b'}}>
                        <span>👍 Mi piace</span><span>💬 Commenta</span><span>↗ Condividi</span>
                      </div>
                    </div>
                  )

                  const IgStoriesPreview = () => (
                    <div style={{background:'#000',borderRadius:14,overflow:'hidden',width:220,height:390,position:'relative',boxShadow:'0 2px 16px rgba(0,0,0,.55)',fontFamily:'system-ui,-apple-system,sans-serif'}}>
                      {imagePreview
                        ? <img src={imagePreview} alt="ad" style={{position:'absolute',inset:0,width:'100%',height:'100%',objectFit:'cover'}} />
                        : <div style={{position:'absolute',inset:0,background:'linear-gradient(135deg,#833ab4,#fd1d1d,#fcb045)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:36}}>🖼️</div>
                      }
                      <div style={{position:'absolute',inset:0,background:'linear-gradient(to bottom,rgba(0,0,0,.35) 0%,transparent 30%,transparent 60%,rgba(0,0,0,.55) 100%)'}} />
                      {/* Top bar */}
                      <div style={{position:'absolute',top:0,left:0,right:0,padding:'10px 10px 6px',display:'flex',alignItems:'center',gap:7}}>
                        <div style={{flex:1,height:2,background:'rgba(255,255,255,.5)',borderRadius:2}} />
                        <div style={{width:26,height:26,borderRadius:'50%',background:'#833ab4',border:'1.5px solid #fff',display:'flex',alignItems:'center',justifyContent:'center',color:'white',fontSize:9,fontWeight:700,flexShrink:0}}>{pageName.charAt(0).toUpperCase()}</div>
                        <div style={{fontSize:10,fontWeight:600,color:'white',flex:1}}>{pageName}</div>
                        <div style={{fontSize:9,color:'rgba(255,255,255,.7)'}}>Sponsorizzato</div>
                        <div style={{color:'rgba(255,255,255,.8)',fontSize:14}}>✕</div>
                      </div>
                      {/* Bottom CTA */}
                      <div style={{position:'absolute',bottom:0,left:0,right:0,padding:'0 12px 16px',textAlign:'center'}}>
                        {adText && <div style={{fontSize:11,color:'white',textShadow:'0 1px 3px rgba(0,0,0,.6)',marginBottom:8,lineHeight:1.4}}>{adText}</div>}
                        <div style={{background:'white',borderRadius:20,padding:'7px 16px',display:'inline-block',fontSize:12,fontWeight:700,color:'#1c1e21',cursor:'default'}}>
                          ↑ {ctaLabel}
                        </div>
                      </div>
                    </div>
                  )

                  const IgFeedPreview = () => (
                    <div style={{background:'#fff',borderRadius:10,overflow:'hidden',width:320,boxShadow:'0 2px 16px rgba(0,0,0,.45)',color:'#262626',fontFamily:'system-ui,-apple-system,sans-serif'}}>
                      {/* Instagram header */}
                      <div style={{display:'flex',alignItems:'center',gap:8,padding:'8px 10px'}}>
                        <div style={{width:30,height:30,borderRadius:'50%',background:'linear-gradient(45deg,#f09433,#e6683c,#dc2743,#cc2366,#bc1888)',padding:1.5,flexShrink:0}}>
                          <div style={{width:'100%',height:'100%',borderRadius:'50%',background:'#fff',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:700,color:'#262626'}}>{pageName.charAt(0).toUpperCase()}</div>
                        </div>
                        <div style={{flex:1}}>
                          <div style={{fontSize:12,fontWeight:700,color:'#262626'}}>{pageName}</div>
                          <div style={{fontSize:10,color:'#8e8e8e'}}>Sponsorizzato</div>
                        </div>
                        <div style={{fontSize:16,color:'#262626',letterSpacing:2}}>···</div>
                      </div>
                      {/* Square image */}
                      {imagePreview
                        ? <img src={imagePreview} alt="ad" style={{width:'100%',height:320,objectFit:'cover',display:'block'}} />
                        : <div style={{height:320,background:'#efefef',display:'flex',alignItems:'center',justifyContent:'center',fontSize:36,color:'#c7c7c7'}}>🖼️</div>
                      }
                      {/* IG actions */}
                      <div style={{padding:'8px 10px 4px',display:'flex',gap:12,fontSize:18}}>
                        <span>🤍</span><span>💬</span><span style={{marginLeft:'auto'}}>🔖</span>
                      </div>
                      <div style={{padding:'0 10px 6px',fontSize:12,color:'#262626',lineHeight:1.5}}>
                        <strong>{pageName}</strong> {adText || ph('Testo principale dell\'annuncio…')}
                      </div>
                      <div style={{margin:'0 10px 8px',background:'#efefef',borderRadius:6,padding:'7px 10px',display:'flex',alignItems:'center',gap:8}}>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{fontSize:11,color:'#8e8e8e',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{displayUrl || ph('tuosito.com')}</div>
                          <div style={{fontSize:12,fontWeight:700,color:'#262626',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{headline || ph('Headline annuncio')}</div>
                        </div>
                        <button style={{padding:'5px 9px',background:'#0095f6',border:'none',borderRadius:6,fontSize:11,fontWeight:700,color:'white',cursor:'default',flexShrink:0,whiteSpace:'nowrap'}}>{ctaLabel}</button>
                      </div>
                    </div>
                  )

                  return (
                  <div>
                    <div style={{fontSize:14,fontWeight:600,marginBottom:16}}>Riepilogo e Lancio</div>
                    {!settings.token && <div style={{padding:'12px 16px',background:'rgba(245,158,11,.1)',border:'1px solid rgba(245,158,11,.3)',borderRadius:8,color:'#fbbf24',fontSize:13,marginBottom:16}}>⚠ Token non configurato. Vai in Impostazioni prima di lanciare.</div>}

                    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,marginBottom:16}}>
                      {[
                        {l:'Campagna',  v:campForm.nome||'—'},
                        {l:'Cliente',   v:adClient?.name||'—'},
                        {l:'Obiettivo', v:campForm.obiettivo.replace('OUTCOME_','')},
                        {l:'Budget',    v:'€'+campForm.budget+(campForm.budgetType==='DAILY'?'/giorno':' totale')},
                        {l:'Paesi',     v:campForm.paesi},
                        {l:'Età',       v:campForm.etaMin+'-'+campForm.etaMax+' anni'},
                        {l:'Inizio',    v:campForm.startDate+(campForm.startTime?' '+campForm.startTime:'')},
                        {l:'Fine',      v:campForm.noEndDate?'Nessuna':campForm.endDate||'—'},
                      ].map(r=>(
                        <div key={r.l}><div style={{fontSize:11,color:'#5a5a78',marginBottom:4}}>{r.l.toUpperCase()}</div><div style={{fontWeight:500,fontSize:13}}>{r.v}</div></div>
                      ))}
                    </div>

                    {/* Format tabs + preview */}
                    <div style={{marginBottom:16}}>
                      <div style={{fontSize:11,color:'#5a5a78',marginBottom:8,textTransform:'uppercase',letterSpacing:.5}}>Preview Inserzione</div>
                      {/* Tab selector */}
                      <div style={{display:'flex',gap:4,marginBottom:14,background:'#0a0a0f',padding:3,borderRadius:8,width:'fit-content'}}>
                        {fmtTabs.map(t => (
                          <button key={t.id} onClick={()=>setPreviewFormat(t.id)} style={{padding:'5px 12px',borderRadius:6,border:'none',fontSize:11,fontWeight:600,cursor:'pointer',background:previewFormat===t.id?'#2a2a38':'transparent',color:previewFormat===t.id?'#c0bcff':'#5a5a78',transition:'all .15s'}}>
                            {t.label}
                          </button>
                        ))}
                      </div>
                      {previewFormat==='fb_feed'    && <FbFeedPreview />}
                      {previewFormat==='ig_stories' && <IgStoriesPreview />}
                      {previewFormat==='ig_feed'    && <IgFeedPreview />}
                    </div>

                    {!imagePreview && <div style={{padding:'10px 14px',background:'rgba(245,158,11,.08)',border:'1px solid rgba(245,158,11,.2)',borderRadius:8,fontSize:12,color:'#fbbf24'}}>⚠ Nessuna immagine caricata — verrà creata la campagna e l'Ad Set, ma non l'annuncio.</div>}
                  </div>
                  )
                })()}
              </div>

              <div style={{display:'flex',justifyContent:step===1?'flex-end':'space-between'}}>
                {step>1 && <button onClick={()=>setStep(step-1)} style={{...btnSecondary,padding:'8px 18px',fontSize:13}}>← Indietro</button>}
                {step<5 && <button onClick={()=>setStep(step+1)} style={{...btnPrimary,padding:'8px 18px',fontSize:13}}>Avanti →</button>}
                {step===5 && (
                  <button onClick={lanciaCampagna} disabled={launching} style={{...btnPrimary,padding:'8px 20px',fontSize:13,opacity:launching?.6:1}}>
                    {launching ? '⏳ Creazione in corso...' : '🚀 Lancia Campagna'}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* ── REGOLE ────────────────────────────────────────────────────── */}
          {page==='regole' && (
            <div>
              <div style={{padding:'12px 16px',background:'rgba(108,99,255,.1)',border:'1px solid rgba(108,99,255,.3)',borderRadius:8,color:'#8b85ff',fontSize:13,marginBottom:16}}>ℹ Le regole attive vengono eseguite ogni ora dal backend Railway — anche quando questa pagina è chiusa.</div>
              <div style={{display:'flex',justifyContent:'flex-end',marginBottom:16}}>
                <button onClick={()=>setModalRule(true)} style={btnPrimary}>+ Aggiungi Regola</button>
              </div>
              {rules.map(r => (
                <div key={r.id} style={{display:'flex',alignItems:'center',gap:12,background:'#1a1a24',border:'1px solid #2a2a38',borderRadius:8,padding:'14px 16px',marginBottom:8}}>
                  <div style={{width:32,height:32,borderRadius:8,background:r.color,display:'flex',alignItems:'center',justifyContent:'center',fontSize:14,flexShrink:0}}>{r.icon}</div>
                  <div style={{flex:1}}>
                    <div style={{fontSize:13,fontWeight:500}}>{r.name}</div>
                    <div style={{fontSize:11,color:'#5a5a78',marginTop:2}}>{r.desc}</div>
                  </div>
                  <div onClick={() => toggleRule(r.id)} style={{width:36,height:20,background:r.on?'#6c63ff':'#2a2a38',borderRadius:10,position:'relative',cursor:'pointer',transition:'background .2s',flexShrink:0}}>
                    <div style={{position:'absolute',width:14,height:14,borderRadius:'50%',background:'white',top:3,left:r.on?19:3,transition:'left .2s'}}></div>
                  </div>
                  <button onClick={() => deleteRule(r.id)} style={{...btnDanger,padding:'4px 8px',fontSize:11,flexShrink:0}}>✕</button>
                </div>
              ))}
            </div>
          )}

          {/* ── REPORT ────────────────────────────────────────────────────── */}
          {page==='report' && (
            <div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:12,marginBottom:16}}>
                {[
                  {t:'Report Settimanale', d:'Ultimi 7 giorni per tutti i clienti',   type:'settimanale'},
                  {t:'Report Mensile',     d:'Ultimi 30 giorni, analisi completa',     type:'mensile'},
                  {t:'Report per Cliente', d:'Tutti gli account, dati aggregati',      type:'per_cliente'},
                ].map(r=>(
                  <div key={r.t} style={{background:'#111118',border:'1px solid #2a2a38',borderRadius:12,padding:16}}>
                    <div style={{fontSize:14,fontWeight:600,marginBottom:6}}>{r.t}</div>
                    <div style={{fontSize:12,color:'#5a5a78',marginBottom:12}}>{r.d}</div>
                    <button
                      onClick={() => generateReport(r.type)}
                      disabled={!!reportLoading}
                      style={{...btnSecondary,width:'100%',padding:'7px',opacity:reportLoading===r.type?.6:1}}
                    >
                      {reportLoading===r.type ? '⏳ Generazione...' : '⬇ Genera CSV'}
                    </button>
                  </div>
                ))}
              </div>
              <div style={{background:'#111118',border:'1px solid #2a2a38',borderRadius:12,padding:20}}>
                <div style={{fontSize:14,fontWeight:600,marginBottom:12}}>Metriche incluse nel report</div>
                <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:8}}>
                  {['Spesa','ROAS','CPC','CTR','CPM','CPA','Impression','Reach','Click','Conversioni','Frequenza','Qualità'].map(m=>(
                    <div key={m} style={{fontSize:12,padding:8,background:'#1a1a24',borderRadius:8,textAlign:'center',color:'#9090b0'}}>{m}</div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── IMPOSTAZIONI ──────────────────────────────────────────────── */}
          {page==='impostazioni' && (
            <div>
              <div style={{background:'#111118',border:'1px solid #2a2a38',borderRadius:12,padding:20,marginBottom:16}}>
                <div style={{fontSize:14,fontWeight:600,marginBottom:4}}>Informazioni Agenzia</div>
                <div style={{fontSize:12,color:'#5a5a78',marginBottom:14}}>Salvate localmente nel tuo browser</div>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:14}}>
                  <div><label style={{fontSize:12,color:'#9090b0',display:'block',marginBottom:6}}>Nome Agenzia</label><input value={settForm.agencyName} onChange={e=>setSettForm({...settForm,agencyName:e.target.value})} placeholder="Digital Agency SRL" style={inputStyle} /></div>
                  <div><label style={{fontSize:12,color:'#9090b0',display:'block',marginBottom:6}}>Email</label><input value={settForm.email} onChange={e=>setSettForm({...settForm,email:e.target.value})} placeholder="info@agenzia.it" style={inputStyle} /></div>
                </div>
                <button onClick={saveSettingsForm} style={btnPrimary}>Salva</button>
              </div>

              <div style={{background:'#111118',border:'1px solid #2a2a38',borderRadius:12,padding:20,marginBottom:16}}>
                <div style={{fontSize:14,fontWeight:600,marginBottom:4}}>Connessione Meta API</div>
                <div style={{fontSize:12,color:'#5a5a78',marginBottom:16}}>Ogni utente inserisce le proprie credenziali — i dati restano nel tuo browser</div>

                <div style={{background:'#0d0d14',border:'1px solid #2a2a48',borderRadius:10,padding:16,marginBottom:20}}>
                  <div style={{fontSize:12,fontWeight:600,color:'#8b85ff',marginBottom:14,letterSpacing:.3}}>Come configurare AdFlow — 3 passi</div>
                  <div style={{display:'flex',flexDirection:'column',gap:12}}>
                    {[
                      { n:1, title:'Crea l\'app Meta', body: <>Vai su <a href="https://developers.facebook.com/apps" target="_blank" rel="noreferrer" style={{color:'#8b85ff',textDecoration:'none'}}>developers.facebook.com/apps</a> → clicca <strong style={{color:'#9090b0'}}>Crea app</strong> → scegli tipo <strong style={{color:'#9090b0'}}>Business</strong> → copia l'<strong style={{color:'#9090b0'}}>App ID</strong> dalla dashboard.</> },
                      { n:2, title:'Crea l\'utente di sistema e genera il token', body: <>Vai su <a href="https://business.facebook.com/settings" target="_blank" rel="noreferrer" style={{color:'#8b85ff',textDecoration:'none'}}>business.facebook.com/settings</a> → <strong style={{color:'#9090b0'}}>Utenti → Utenti di sistema → Aggiungi</strong> con ruolo Admin → assegna gli ad account → <strong style={{color:'#9090b0'}}>Genera token</strong> con permessi <strong style={{color:'#9090b0'}}>ads_management</strong> e <strong style={{color:'#9090b0'}}>ads_read</strong>.</> },
                      { n:3, title:'Trova il Business Manager ID', body: <>Sempre su <a href="https://business.facebook.com/settings" target="_blank" rel="noreferrer" style={{color:'#8b85ff',textDecoration:'none'}}>business.facebook.com/settings</a> → <strong style={{color:'#9090b0'}}>Informazioni business</strong>. Il numero ID è in cima alla pagina.</> },
                    ].map((s, i, arr) => (
                      <div key={s.n}>
                        <div style={{display:'flex',gap:12,alignItems:'flex-start'}}>
                          <div style={{width:24,height:24,borderRadius:'50%',background:'rgba(108,99,255,.25)',color:'#8b85ff',fontSize:11,fontWeight:700,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,marginTop:1}}>{s.n}</div>
                          <div>
                            <div style={{fontSize:12,fontWeight:600,color:'#e0e0f0',marginBottom:3}}>{s.title}</div>
                            <div style={{fontSize:11,color:'#5a5a78',lineHeight:1.6}}>{s.body}</div>
                          </div>
                        </div>
                        {i < arr.length - 1 && <div style={{borderTop:'1px solid #1e1e2e',marginTop:12}}></div>}
                      </div>
                    ))}
                  </div>
                </div>

                <div style={{marginBottom:14}}>
                  <label style={{fontSize:12,color:'#9090b0',display:'block',marginBottom:6}}>App ID Meta</label>
                  <input type="text" value={settForm.appId} onChange={e=>setSettForm({...settForm,appId:e.target.value})} placeholder="Es. 1234567890123456" style={monoInputStyle} />
                  <div style={helpText}>L'ID della tua app Meta (step 1). Lo trovi nella dashboard di <a href="https://developers.facebook.com/apps" target="_blank" rel="noreferrer" style={{color:'#6c63ff',textDecoration:'none'}}>developers.facebook.com</a>.</div>
                </div>
                <div style={{marginBottom:14}}>
                  <label style={{fontSize:12,color:'#9090b0',display:'block',marginBottom:6}}>System User Token</label>
                  <input type={!tokenVisible?'password':'text'} value={settForm.token} onChange={e=>setSettForm({...settForm,token:e.target.value})} placeholder="Token generato nello step 2…" style={monoInputStyle} />
                  <div style={helpText}>Il token che autorizza AdFlow a gestire le campagne (step 2). Copialo subito — non viene mostrato di nuovo.</div>
                </div>
                <div style={{marginBottom:16}}>
                  <label style={{fontSize:12,color:'#9090b0',display:'block',marginBottom:6}}>Business Manager ID</label>
                  <input type="text" value={settForm.bmId} onChange={e=>setSettForm({...settForm,bmId:e.target.value})} placeholder="Es. 123456789012345" style={monoInputStyle} />
                  <div style={helpText}>Il numero ID del tuo Business Manager (step 3). Solo cifre, tipo <em>123456789012345</em>.</div>
                </div>

                <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
                  <button onClick={saveSettingsForm} style={btnPrimary}>Salva Credenziali</button>
                  <button onClick={()=>setTokenVisible(!tokenVisible)} style={btnSecondary}>{tokenVisible?'Nascondi Token':'Mostra Token'}</button>
                  <button onClick={testConnection} style={btnSecondary}>Testa Connessione</button>
                  {connStatus && <span style={{fontSize:12,color:connStatus.includes('✅')?'#22c55e':connStatus.includes('❌')?'#ef4444':'#9090b0'}}>{connStatus}</span>}
                </div>
              </div>
            </div>
          )}

        </div>
      </main>

      {/* ── MODAL CLIENTE (aggiungi / modifica) ──────────────────────────── */}
      {(modalClient || editingClient) && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.7)',zIndex:100,display:'flex',alignItems:'center',justifyContent:'center'}}>
          <div style={{background:'#111118',border:'1px solid #3a3a4e',borderRadius:16,padding:24,width:520,maxWidth:'95vw',maxHeight:'85vh',overflowY:'auto'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20}}>
              <div style={{fontFamily:'Syne,sans-serif',fontSize:16,fontWeight:700}}>{editingClient ? 'Modifica Cliente' : 'Aggiungi Cliente'}</div>
              <button onClick={() => { setModalClient(false); setEditingClient(null); setClientForm({ name:'', adAccount:'', pageId:'', sector:'E-commerce', notes:'' }) }} style={{background:'none',border:'none',color:'#5a5a78',cursor:'pointer',fontSize:18}}>✕</button>
            </div>
            <div style={{marginBottom:14}}>
              <label style={{fontSize:12,color:'#9090b0',display:'block',marginBottom:6}}>Nome Cliente / Azienda</label>
              <input value={clientForm.name} onChange={e=>setClientForm({...clientForm,name:e.target.value})} placeholder="Es. Rossini Srl" style={inputStyle} />
            </div>
            <div style={{marginBottom:14}}>
              <label style={{fontSize:12,color:'#9090b0',display:'block',marginBottom:6}}>Ad Account ID</label>
              <input value={clientForm.adAccount} onChange={e=>setClientForm({...clientForm,adAccount:e.target.value})} placeholder="act_123456789" style={monoInputStyle} />
              <div style={helpText}>Formato <strong style={{color:'#9090b0'}}>act_</strong> + numero. Trovalo in Business Manager → Account pubblicitari.</div>
            </div>
            <div style={{marginBottom:14}}>
              <label style={{fontSize:12,color:'#9090b0',display:'block',marginBottom:6}}>Pagina Facebook ID</label>
              <input value={clientForm.pageId} onChange={e=>setClientForm({...clientForm,pageId:e.target.value})} placeholder="123456789" style={monoInputStyle} />
              <div style={helpText}>Necessario per creare annunci con creatività. Trovalo nell'URL della pagina Facebook o in Business Manager.</div>
            </div>
            <div style={{marginBottom:14}}>
              <label style={{fontSize:12,color:'#9090b0',display:'block',marginBottom:6}}>Settore</label>
              <select value={clientForm.sector} onChange={e=>setClientForm({...clientForm,sector:e.target.value})} style={inputStyle}>
                {['E-commerce','Ristorazione','Immobiliare','Salute & Benessere','Moda & Lifestyle','B2B / Servizi','Turismo','Altro'].map(s=><option key={s}>{s}</option>)}
              </select>
            </div>
            <div style={{marginBottom:20}}>
              <label style={{fontSize:12,color:'#9090b0',display:'block',marginBottom:6}}>Note</label>
              <textarea value={clientForm.notes} onChange={e=>setClientForm({...clientForm,notes:e.target.value})} style={{...inputStyle,minHeight:70,resize:'vertical'}} />
            </div>
            <div style={{display:'flex',justifyContent:'flex-end',gap:8}}>
              <button onClick={() => { setModalClient(false); setEditingClient(null); setClientForm({ name:'', adAccount:'', pageId:'', sector:'E-commerce', notes:'' }) }} style={btnSecondary}>Annulla</button>
              <button onClick={editingClient ? updateClient : saveClient} style={btnPrimary}>{editingClient ? 'Salva modifiche' : 'Aggiungi'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL REGOLA ─────────────────────────────────────────────────── */}
      {modalRule && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.7)',zIndex:100,display:'flex',alignItems:'center',justifyContent:'center'}}>
          <div style={{background:'#111118',border:'1px solid #3a3a4e',borderRadius:16,padding:24,width:480,maxWidth:'95vw'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20}}>
              <div style={{fontFamily:'Syne,sans-serif',fontSize:16,fontWeight:700}}>Nuova Regola Automatica</div>
              <button onClick={()=>setModalRule(false)} style={{background:'none',border:'none',color:'#5a5a78',cursor:'pointer',fontSize:18}}>✕</button>
            </div>
            {[
              {label:'Nome regola',    key:'name',      tag:'input',  placeholder:'Es. Pausa se CPA alto'},
              {label:'Condizione',     key:'condition', tag:'select', opts:[{v:'cpa_gt',l:'CPA maggiore di'},{v:'roas_gt',l:'ROAS maggiore di'},{v:'ctr_lt',l:'CTR minore di'},{v:'spend_gt',l:'Spesa maggiore di'}]},
              {label:'Valore soglia',  key:'value',     tag:'input',  type:'number', placeholder:'Es. 10'},
              {label:'Azione',         key:'action',    tag:'select', opts:[{v:'pause',l:'Metti in pausa'},{v:'budget_increase',l:'Aumenta budget 20%'},{v:'budget_decrease',l:'Riduci budget 20%'},{v:'notify',l:'Solo notifica'}]},
            ].map(f=>(
              <div key={f.key} style={{marginBottom:14}}>
                <label style={{fontSize:12,color:'#9090b0',display:'block',marginBottom:6}}>{f.label}</label>
                {f.tag==='select'
                  ? <select value={ruleForm[f.key]} onChange={e=>setRuleForm({...ruleForm,[f.key]:e.target.value})} style={inputStyle}>{f.opts.map(o=><option key={o.v} value={o.v}>{o.l}</option>)}</select>
                  : <input type={f.type||'text'} value={ruleForm[f.key]} onChange={e=>setRuleForm({...ruleForm,[f.key]:e.target.value})} placeholder={f.placeholder} style={inputStyle} />
                }
              </div>
            ))}
            <div style={{display:'flex',justifyContent:'flex-end',gap:8,marginTop:8}}>
              <button onClick={()=>setModalRule(false)} style={btnSecondary}>Annulla</button>
              <button onClick={saveRule} style={btnPrimary}>Aggiungi</button>
            </div>
          </div>
        </div>
      )}

      {/* ── NOTIFICA ─────────────────────────────────────────────────────── */}
      {showNotif && (
        <div style={{position:'fixed',bottom:24,right:24,background:'#1a1a24',border:'1px solid #3a3a4e',borderLeft:'3px solid #6c63ff',borderRadius:12,padding:'14px 18px',fontSize:13,zIndex:200,maxWidth:320}}>
          {notif}
        </div>
      )}
    </div>
  )
}
