import { useState, useEffect, useRef } from 'react'
import './App.css'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

function MiniChart({ data, color = '#00c8ff', height = 56 }) {
  if (!data || data.length < 2) return <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#4d4d6e', fontSize: 11 }}>—</div>
  const W = 400, H = height
  const max = Math.max(...data), min = Math.min(...data), range = max - min || 1
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * (W - 20) + 10},${H - 6 - ((v - min) / range) * (H - 12)}`).join(' ')
  const first = pts.split(' ')[0], last = pts.split(' ').slice(-1)[0]
  const [lx, ly] = last.split(',')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height }} preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lx} cy={ly} r="4" fill={color} />
    </svg>
  )
}

const COLORS = ['#00c8ff','#22c55e','#ff6b35','#ef4444','#3b82f6','#ec4899','#14b8a6']
const API = import.meta.env.VITE_API_URL || ''

const STATUS_STYLE = {
  ACTIVE:        { bg: 'rgba(34,197,94,.15)',   color: '#4ade80' },
  PAUSED:        { bg: 'rgba(245,158,11,.15)',  color: '#fbbf24' },
  DELETED:       { bg: 'rgba(239,68,68,.15)',   color: '#f87171' },
  ARCHIVED:      { bg: 'rgba(90,90,120,.2)',    color: '#8080a8' },
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
    { id:4, name:'Pausa se CTR < 0.5%',       desc:'Sospende annunci con CTR troppo basso dopo 1000 impression',on:false, icon:'📉', color:'rgba(0,200,255,.15)',condition:'ctr_lt',   value:'0.5', action:'pause' },
  ]
}
function saveRules(r) { localStorage.setItem('adflow_rules', JSON.stringify(r)) }

const DRAFT_KEY = 'adflow_draft'
const PAGE_KEY  = 'adflow_last_page'
function getDraft() { try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null') } catch { return null } }
function clearDraftStorage() { localStorage.removeItem(DRAFT_KEY) }

const DEFAULT_CAMP_FORM = {
  nome:'', clienteId:'', obiettivo:'OUTCOME_TRAFFIC', formato:'image',
  etaMin:'18', etaMax:'45', genere:'0', paesi:'IT', interessi:'',
  placement:'automatic', adText:'', adHeadline:'', adDesc:'', adUrl:'',
  adCta:'LEARN_MORE', pageId:'', customAudienceId:'', budgetType:'DAILY', budget:'10',
  startDate: '', startTime:'00:00',
  endDate:'', noEndDate:false, bidStrategy:'LOWEST_COST_WITHOUT_CAP',
}
const DEFAULT_CAROUSEL = [
  { id: 1, imageBase64: null, imagePreview: null, title: '', url: '' },
  { id: 2, imageBase64: null, imagePreview: null, title: '', url: '' },
]

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
  if (form.customAudienceId) targeting.custom_audiences = [{ id: form.customAudienceId }]
  return targeting
}

export default function App() {
  const [page, setPage] = useState(() => localStorage.getItem(PAGE_KEY) || 'dashboard')
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
  const [multiImages, setMultiImages] = useState({ square: null, vertical: null, stories: null })
  const [videoFile, setVideoFile] = useState(null)
  const [videoPreview, setVideoPreview] = useState(null)
  const [dashMetrics, setDashMetrics] = useState({ spend: '—', roas: '—' })
  const [clientInsights, setClientInsights] = useState({})
  const [reportLoading, setReportLoading] = useState(null)
  const [rules, setRules] = useState(getRules())
  const [availablePages, setAvailablePages] = useState([])
  const [pagesLoading, setPagesLoading] = useState(false)
  const [audiences, setAudiences] = useState([])
  const [audiencesLoading, setAudiencesLoading] = useState(false)
  const [carouselCards, setCarouselCards] = useState(DEFAULT_CAROUSEL.map(c => ({ ...c })))
  const [dashChartData, setDashChartData] = useState([])
  const [selectedCampaign, setSelectedCampaign] = useState(null)
  const [breakdownData, setBreakdownData] = useState({})
  const [breakdownLoading, setBreakdownLoading] = useState(false)
  const [breakdownTab, setBreakdownTab] = useState('age')

  const [campForm, setCampForm] = useState(() => ({ ...DEFAULT_CAMP_FORM, startDate: new Date().toISOString().split('T')[0] }))
  const [showDraftBanner, setShowDraftBanner] = useState(() => {
    const restoredPage = localStorage.getItem(PAGE_KEY) || 'dashboard'
    return restoredPage === 'crea' && !!getDraft()
  })

  const [clientForm, setClientForm] = useState({ name:'', adAccount:'', pageId:'', sector:'E-commerce', notes:'' })
  const [settForm, setSettForm] = useState({ agencyName: settings.agencyName||'', email: settings.email||'', token: settings.token||'', bmId: settings.bmId||'', appId: settings.appId||'' })
  const [ruleForm, setRuleForm] = useState({ name:'', condition:'cpa_gt', value:'', action:'pause' })

  // ── Effects ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (settings.token) { fetchAllInsights(settings.token); fetchDashChartData(settings.token) }
  }, [settings.token])

  useEffect(() => {
    localStorage.setItem(PAGE_KEY, page)
  }, [page])

  useEffect(() => {
    if (page !== 'crea') return
    if (!campForm.nome && step === 1) return
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({
        form: campForm,
        cards: carouselCards.map(({ id, title, url, imageBase64, imagePreview }) => ({ id, title, url, imageBase64, imagePreview })),
        multiImages,
        step,
      }))
    } catch {}
  }, [campForm, carouselCards, multiImages, step, page])

  useEffect(() => {
    if (page !== 'crea') return
    const d = getDraft()
    setShowDraftBanner(!!d)
  }, [page])

  useEffect(() => {
    if (!campForm.clienteId || !settings.token) { setAudiences([]); return }
    const client = clients.find(c => c.id === campForm.clienteId)
    if (!client?.adAccount) { setAudiences([]); return }
    setAudiencesLoading(true)
    fetch(`${API}/api/audiences?account_id=${client.adAccount}`, { headers: { 'x-meta-token': settings.token } })
      .then(r => r.json())
      .then(data => setAudiences(data.data || []))
      .catch(() => setAudiences([]))
      .finally(() => setAudiencesLoading(false))
  }, [campForm.clienteId, settings.token])

  useEffect(() => {
    if (!campForm.clienteId || !settings.token) { setAvailablePages([]); return }
    const client = clients.find(c => c.id === campForm.clienteId)
    if (!client?.adAccount) { setAvailablePages([]); return }
    setPagesLoading(true)
    fetch(`${API}/api/pages?account_id=${client.adAccount}`, { headers: { 'x-meta-token': settings.token } })
      .then(r => r.json())
      .then(data => {
        const pages = data.data || []
        setAvailablePages(pages)
        if (pages.length === 1) {
          setCampForm(f => ({ ...f, pageId: pages[0].id }))
        } else if (client.pageId && pages.find(p => p.id === client.pageId)) {
          setCampForm(f => ({ ...f, pageId: client.pageId }))
        }
      })
      .catch(() => setAvailablePages([]))
      .finally(() => setPagesLoading(false))
  }, [campForm.clienteId, settings.token])

  // ── Helpers ────────────────────────────────────────────────────────────────
  function notify(msg) { setNotif(msg); setShowNotif(true); setTimeout(() => setShowNotif(false), 3500) }

  function clearDraft() {
    clearDraftStorage()
    setCampForm({ ...DEFAULT_CAMP_FORM, startDate: new Date().toISOString().split('T')[0] })
    setCarouselCards(DEFAULT_CAROUSEL.map(c => ({ ...c })))
    setMultiImages({ square: null, vertical: null, stories: null })
    setVideoFile(null); setVideoPreview(null)
    setStep(1)
    setShowDraftBanner(false)
    notify('Bozza cancellata')
  }

  function navigateToCrea() {
    const d = getDraft()
    if (d) {
      setShowDraftBanner(true)
    } else {
      setCampForm({ ...DEFAULT_CAMP_FORM, startDate: new Date().toISOString().split('T')[0] })
      setCarouselCards(DEFAULT_CAROUSEL.map(c => ({ ...c })))
      setStep(1)
      setShowDraftBanner(false)
    }
    setPage('crea')
  }

  function resumeDraft() {
    const d = getDraft()
    if (!d) return
    if (d.form) setCampForm(d.form)
    if (d.cards) setCarouselCards(d.cards.map(c => ({ ...c })))
    if (d.multiImages) setMultiImages(d.multiImages)
    if (d.step) setStep(d.step)
    setShowDraftBanner(false)
    notify('Bozza ripristinata')
  }

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
  function handleMultiImageSelect(slot, file) {
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      setMultiImages(prev => ({ ...prev, [slot]: { base64: ev.target.result.split(',')[1], preview: ev.target.result, fileName: file.name } }))
    }
    reader.readAsDataURL(file)
  }

  function handleVideoSelect(file) {
    if (!file) return
    setVideoFile(file)
    setVideoPreview(URL.createObjectURL(file))
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

      // 3 — Upload immagine / immagini carosello
      const resolvedPageId = campForm.pageId || client.pageId
      let imageHash = null
      let carouselHashes = []

      if (campForm.formato === 'carousel' && adsetId) {
        notify('3/4 Upload immagini carosello...')
        for (const card of carouselCards) {
          if (!card.imageBase64) { carouselHashes.push(null); continue }
          try {
            const imgData = await (await fetch(`${API}/api/adaccounts/${client.adAccount}/adimages`, {
              method: 'POST', headers, body: JSON.stringify({ imageBase64: card.imageBase64, filename: `card_${card.id}.jpg` }),
            })).json()
            carouselHashes.push(imgData.images ? Object.values(imgData.images)[0]?.hash : null)
          } catch { carouselHashes.push(null) }
        }
      } else {
        const primaryBase64 = multiImages.square?.base64 || multiImages.vertical?.base64 || multiImages.stories?.base64
        const primaryFileName = multiImages.square?.fileName || multiImages.vertical?.fileName || multiImages.stories?.fileName || 'creative.jpg'
        if (primaryBase64 && adsetId) {
          notify('3/4 Upload immagine creativa...')
          try {
            const imgData = await (await fetch(`${API}/api/adaccounts/${client.adAccount}/adimages`, {
              method: 'POST', headers, body: JSON.stringify({ imageBase64: primaryBase64, filename: primaryFileName }),
            })).json()
            if (!imgData.error && imgData.images) imageHash = Object.values(imgData.images)[0]?.hash || null
          } catch {}
        }
      }

      // 4 — Creative + Ad
      let adCreated = false
      if (campForm.formato === 'carousel' && resolvedPageId && adsetId) {
        notify('4/4 Creazione carosello...')
        try {
          const child_attachments = carouselCards.map((card, i) => ({
            link: card.url || campForm.adUrl || 'https://example.com',
            ...(carouselHashes[i] ? { image_hash: carouselHashes[i] } : {}),
            name: card.title || campForm.adHeadline || '',
            call_to_action: { type: campForm.adCta },
          }))
          const creativeData = await (await fetch(`${API}/api/adaccounts/${client.adAccount}/adcreatives`, {
            method: 'POST', headers, body: JSON.stringify({
              name: campForm.nome + ' – Carousel',
              object_story_spec: { page_id: resolvedPageId, link_data: { link: campForm.adUrl || 'https://example.com', message: campForm.adText, child_attachments, multi_share_optimized: true } },
            }),
          })).json()
          if (!creativeData.error && creativeData.id) {
            await fetch(`${API}/api/adaccounts/${client.adAccount}/ads`, { method: 'POST', headers, body: JSON.stringify({ name: campForm.nome + ' – Ad', adset_id: adsetId, creative: { creative_id: creativeData.id }, status: 'PAUSED' }) })
            adCreated = true
          }
        } catch {}
      } else if (imageHash && campForm.adUrl && resolvedPageId && adsetId) {
        notify('4/4 Creazione creative e annuncio...')
        try {
          const creativeRes = await fetch(`${API}/api/adaccounts/${client.adAccount}/adcreatives`, {
            method: 'POST', headers,
            body: JSON.stringify({
              name: campForm.nome + ' – Creative',
              page_id: resolvedPageId,
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
      clearDraftStorage()
      setMultiImages({ square: null, vertical: null, stories: null })
      setVideoFile(null); setVideoPreview(null)
      setCampForm({ ...DEFAULT_CAMP_FORM, startDate: new Date().toISOString().split('T')[0] })
      setCarouselCards(DEFAULT_CAROUSEL.map(c => ({ ...c })))
      setStep(1)
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
      id: Date.now(), name: ruleForm.name, on: false, icon: '⚡', color: 'rgba(0,200,255,.15)',
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

  // ── Carousel ──────────────────────────────────────────────────────────────
  function addCarouselCard() {
    if (carouselCards.length >= 10) { notify('Massimo 10 schede'); return }
    setCarouselCards(cs => [...cs, { id: Date.now(), imageBase64: null, imagePreview: null, title: '', url: '' }])
  }
  function removeCarouselCard(id) {
    if (carouselCards.length <= 2) { notify('Minimo 2 schede'); return }
    setCarouselCards(cs => cs.filter(c => c.id !== id))
  }
  function updateCarouselCard(id, field, value) {
    setCarouselCards(cs => cs.map(c => c.id === id ? { ...c, [field]: value } : c))
  }
  function handleCarouselImageSelect(id, file) {
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      const b64 = ev.target.result.split(',')[1]
      setCarouselCards(cs => cs.map(c => c.id === id ? { ...c, imageBase64: b64, imagePreview: ev.target.result } : c))
    }
    reader.readAsDataURL(file)
  }

  // ── Chart data ─────────────────────────────────────────────────────────────
  async function fetchDashChartData(token) {
    const allClients = getClients().filter(c => c.adAccount)
    if (!allClients.length) return
    const headers = { 'x-meta-token': token }
    const daily = {}
    await Promise.allSettled(allClients.map(async client => {
      try {
        const res = await fetch(`${API}/api/insights?account_id=${client.adAccount}&date_preset=last_7d&time_increment=1`, { headers })
        const data = await res.json()
        for (const d of (data.data || [])) {
          const day = d.date_start
          if (!daily[day]) daily[day] = { spend: 0, pv: 0 }
          daily[day].spend += parseFloat(d.spend || 0)
          const pv = (d.action_values || []).find(a => a.action_type === 'purchase')
          daily[day].pv += parseFloat(pv?.value || 0)
        }
      } catch {}
    }))
    const days = Object.keys(daily).sort()
    setDashChartData(days.map(d => ({ date: d.slice(5), spend: daily[d].spend, roas: daily[d].spend > 0 ? daily[d].pv / daily[d].spend : 0 })))
  }

  // ── Breakdown ──────────────────────────────────────────────────────────────
  async function openCampaignBreakdown(camp) {
    setSelectedCampaign(camp)
    setBreakdownTab('age')
    setBreakdownData({})
    if (!settings.token || !camp.fromMeta) return
    setBreakdownLoading(true)
    const headers = { 'x-meta-token': settings.token }
    try {
      const [ageRes, genderRes, placementRes] = await Promise.all([
        fetch(`${API}/api/campaigns/${camp.id}/insights?date_preset=last_30d&breakdowns=age`, { headers }),
        fetch(`${API}/api/campaigns/${camp.id}/insights?date_preset=last_30d&breakdowns=gender`, { headers }),
        fetch(`${API}/api/campaigns/${camp.id}/insights?date_preset=last_30d&breakdowns=publisher_platform`, { headers }),
      ])
      const [age, gender, placement] = await Promise.all([ageRes.json(), genderRes.json(), placementRes.json()])
      setBreakdownData({ age: age.data || [], gender: gender.data || [], placement: placement.data || [] })
    } catch {}
    setBreakdownLoading(false)
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

  async function generatePDF(type) {
    if (!settings.token) { notify('Configura prima il token API'); return }
    setReportLoading(type + '_pdf')
    const date_preset = type === 'settimanale' ? 'last_7d' : 'last_30d'
    const period = type === 'settimanale' ? 'Ultimi 7 giorni' : 'Ultimi 30 giorni'
    try {
      const headers = metaHeaders()
      const accountsData = await (await fetch(`${API}/api/adaccounts`, { headers })).json()
      if (accountsData.error) { notify('❌ ' + accountsData.error); setReportLoading(null); return }
      const rows = []
      await Promise.allSettled((accountsData.data || []).map(async acc => {
        const d = ((await (await fetch(`${API}/api/insights?account_id=${acc.id}&date_preset=${date_preset}`, { headers })).json()).data || [])[0] || {}
        const spend = parseFloat(d.spend || 0)
        const pv = parseFloat((d.action_values || []).find(a => a.action_type === 'purchase')?.value || 0)
        rows.push([acc.name, `€${spend.toFixed(2)}`, String(d.impressions || 0), String(d.clicks || 0), d.ctr ? parseFloat(d.ctr).toFixed(2)+'%' : '—', spend > 0 ? (pv/spend).toFixed(2)+'x' : '—'])
      }))
      const doc = new jsPDF()
      doc.setFillColor(0, 180, 220)
      doc.rect(0, 0, 210, 28, 'F')
      doc.setFontSize(18); doc.setTextColor(255); doc.setFont('helvetica', 'bold')
      doc.text('AdFlow Report', 14, 17)
      doc.setFontSize(9); doc.setFont('helvetica', 'normal')
      doc.text(`${period} · ${new Date().toLocaleDateString('it-IT')}`, 14, 23)
      if (settings.agencyName) doc.text(settings.agencyName, 196, 17, { align: 'right' })
      const totalSpend = rows.reduce((s, r) => s + parseFloat(r[1].replace('€','') || 0), 0)
      doc.setTextColor(50); doc.setFontSize(10)
      doc.text(`Spesa totale: €${totalSpend.toFixed(2)}  ·  Account: ${rows.length}`, 14, 36)
      autoTable(doc, {
        startY: 42,
        head: [['Account', 'Spesa', 'Impression', 'Click', 'CTR', 'ROAS']],
        body: rows,
        headStyles: { fillColor: [0, 180, 220] },
        alternateRowStyles: { fillColor: [232, 248, 252] },
        styles: { fontSize: 9 },
      })
      doc.save(`adflow-report-${type}-${new Date().toISOString().split('T')[0]}.pdf`)
      notify('✅ Report PDF generato!')
    } catch (e) { notify('❌ Errore PDF: ' + e.message) }
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

  const inputStyle = { width:'100%', background:'#10101e', border:'1px solid #1e1e30', borderRadius:8, padding:'9px 12px', fontSize:13, color:'#eef0f8', fontFamily:'DM Sans,sans-serif' }
  const monoInputStyle = { ...inputStyle, fontFamily:"monospace", fontSize:12 }
  const btnPrimary = { padding:'8px 18px', borderRadius:8, background:'#00c8ff', color:'#06060b', border:'none', fontSize:12, fontWeight:600, cursor:'pointer', fontFamily:'DM Sans,sans-serif', letterSpacing:'0.02em' }
  const btnSecondary = { padding:'8px 18px', borderRadius:8, background:'transparent', color:'#8080a8', border:'1px solid #1e1e30', fontSize:12, cursor:'pointer', fontFamily:'DM Sans,sans-serif' }
  const btnDanger = { padding:'5px 10px', borderRadius:6, background:'rgba(239,68,68,.08)', color:'#f87171', border:'1px solid rgba(239,68,68,.25)', fontSize:11, cursor:'pointer', fontFamily:'DM Sans,sans-serif' }
  const helpText = { fontSize:11, color:'#4d4d6e', marginTop:5, lineHeight:1.5 }

  // ── Status badge ───────────────────────────────────────────────────────────
  function StatusBadge({ status }) {
    const s = STATUS_STYLE[status] || STATUS_STYLE.ARCHIVED
    return <span style={{ padding:'3px 8px', borderRadius:20, fontSize:11, background:s.bg, color:s.color }}>● {status}</span>
  }

  return (
    <div style={{display:'flex',minHeight:'100vh',background:'#06060b',color:'#eef0f8',fontFamily:'DM Sans,sans-serif'}}>

      {/* SIDEBAR */}
      <aside style={{width:220,background:'#09091a',borderRight:'1px solid #1e1e30',display:'flex',flexDirection:'column'}}>
        <div style={{padding:'20px 20px 16px',borderBottom:'1px solid #1e1e30'}}>
          <div style={{fontFamily:'Syne,sans-serif',fontSize:30,letterSpacing:'0.04em',lineHeight:1}}>Ad<span style={{color:'#00c8ff'}}>Flow</span></div>
          <div style={{fontSize:10,color:'#4d4d6e',marginTop:4,letterSpacing:'0.08em',textTransform:'uppercase'}}>Agency Ads Platform</div>
        </div>
        <nav style={{padding:'12px 10px',flex:1}}>
          {navItems.map(n => (
            <button key={n.id} onClick={() => n.id === 'crea' ? navigateToCrea() : setPage(n.id)} style={{display:'flex',alignItems:'center',gap:10,padding:'9px 10px',borderRadius:8,cursor:'pointer',fontSize:13,fontWeight:page===n.id?600:400,color:page===n.id?'#00c8ff':'#8080a8',background:page===n.id?'rgba(0,200,255,.08)':'none',border:page===n.id?'1px solid rgba(0,200,255,.2)':'1px solid transparent',width:'100%',textAlign:'left',marginBottom:2,fontFamily:'DM Sans,sans-serif',transition:'all 0.15s'}}>
              <span style={{fontSize:14,opacity:page===n.id?1:.6}}>{n.icon}</span>{n.label}
            </button>
          ))}
        </nav>
        <div style={{padding:'12px 10px',borderTop:'1px solid #1e1e30'}}>
          <div style={{display:'flex',alignItems:'center',gap:10,padding:10,background:'#10101e',borderRadius:8,fontSize:13}}>
            <div style={{width:28,height:28,borderRadius:6,background:'#0099bb',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:700,flexShrink:0}}>{(settings.agencyName||'A').charAt(0).toUpperCase()}</div>
            <div>
              <div style={{fontSize:12,fontWeight:500}}>{settings.agencyName||'La mia Agenzia'}</div>
              <div style={{fontSize:10,color:settings.token?'#22c55e':'#4d4d6e'}}>{settings.token?'● Token configurato':'● Token mancante'}</div>
            </div>
          </div>
        </div>
      </aside>

      {/* MAIN */}
      <main style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>
        <div style={{padding:'16px 24px',borderBottom:'1px solid #1e1e30',background:'#09091a',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          <div style={{fontFamily:'Syne,sans-serif',fontSize:22,letterSpacing:'0.04em'}}>{navItems.find(n=>n.id===page)?.label}</div>
          <div style={{display:'flex',gap:8}}>
            <button onClick={() => setPage('impostazioni')} style={btnSecondary}>⚙ Token</button>
            <button onClick={() => { navigateToCrea(); setStep(1) }} style={btnPrimary}>+ Nuova Campagna</button>
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
                  <div key={i} style={{background:'#09091a',border:'1px solid #1e1e30',borderRadius:12,padding:'16px 18px'}}>
                    <div style={{fontSize:10,color:'#4d4d6e',textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:10}}>{s.label}</div>
                    <div style={{fontSize:26,fontWeight:500,fontFamily:"monospace",color:'#eef0f8'}}>{s.val}</div>
                  </div>
                ))}
              </div>
              {dashChartData.length > 1 && (
                <div style={{background:'#09091a',border:'1px solid #1e1e30',borderRadius:12,padding:20,marginBottom:16}}>
                  <div style={{fontSize:13,fontWeight:600,marginBottom:12}}>Andamento ultimi 7 giorni</div>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>
                    <div>
                      <div style={{fontSize:11,color:'#4d4d6e',marginBottom:4}}>SPESA (€)</div>
                      <MiniChart data={dashChartData.map(d=>d.spend)} color="#00c8ff" height={56} />
                      <div style={{display:'flex',justifyContent:'space-between',fontSize:10,color:'#4d4d6e',marginTop:2}}>
                        <span>{dashChartData[0]?.date}</span><span>{dashChartData.slice(-1)[0]?.date}</span>
                      </div>
                    </div>
                    <div>
                      <div style={{fontSize:11,color:'#4d4d6e',marginBottom:4}}>ROAS</div>
                      <MiniChart data={dashChartData.map(d=>d.roas)} color="#22c55e" height={56} />
                      <div style={{display:'flex',justifyContent:'space-between',fontSize:10,color:'#4d4d6e',marginTop:2}}>
                        <span>{dashChartData[0]?.date}</span><span>{dashChartData.slice(-1)[0]?.date}</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
              <div style={{background:'#09091a',border:'1px solid #1e1e30',borderRadius:12,padding:20}}>
                <div style={{fontSize:14,fontWeight:600,marginBottom:16}}>Come iniziare</div>
                <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:16}}>
                  {[{n:1,t:'Configura il Token',d:'Inserisci il System User Token in Impostazioni'},{n:2,t:'Aggiungi Clienti',d:'Collega gli ad account dei tuoi clienti'},{n:3,t:'Lancia Campagne',d:'Crea campagne senza toccare Facebook'}].map(s => (
                    <div key={s.n} style={{textAlign:'center',padding:16}}>
                      <div style={{width:40,height:40,borderRadius:'50%',background:'rgba(0,200,255,.15)',display:'flex',alignItems:'center',justifyContent:'center',margin:'0 auto 10px',fontSize:16,fontWeight:700,color:'#33d4ff'}}>{s.n}</div>
                      <div style={{fontSize:13,fontWeight:500,marginBottom:4}}>{s.t}</div>
                      <div style={{fontSize:11,color:'#4d4d6e'}}>{s.d}</div>
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
                <div style={{textAlign:'center',padding:60,color:'#4d4d6e'}}>
                  <div style={{fontSize:40,marginBottom:12}}>🏢</div>
                  <div style={{fontSize:13}}>Nessun cliente. Clicca "Aggiungi Cliente" per iniziare.</div>
                </div>
              ) : (
                <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:12}}>
                  {clients.map((c,i) => (
                    <div key={c.id} style={{background:'#09091a',border:'1px solid #1e1e30',borderRadius:12,padding:16}}>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:10}}>
                        <div style={{width:40,height:40,borderRadius:10,background:COLORS[i%COLORS.length]+'22',color:COLORS[i%COLORS.length],display:'flex',alignItems:'center',justifyContent:'center',fontSize:14,fontWeight:700}}>{c.name.substring(0,2).toUpperCase()}</div>
                        <div style={{display:'flex',gap:6}}>
                          <button onClick={() => openEditClient(c)} style={{...btnSecondary,padding:'4px 8px',fontSize:11}}>✏ Modifica</button>
                          <button onClick={() => deleteClient(c.id)} style={btnDanger}>✕</button>
                        </div>
                      </div>
                      <div style={{fontSize:14,fontWeight:600}}>{c.name}</div>
                      <div style={{fontSize:11,color:'#4d4d6e',marginTop:2}}>{c.sector} • {c.adAccount||'No Ad Account'}</div>
                      <div style={{display:'flex',gap:12,marginTop:12,paddingTop:12,borderTop:'1px solid #1e1e30'}}>
                        <div style={{fontSize:11,color:'#8080a8'}}><strong style={{display:'block',fontSize:13,color:'#eef0f8'}}>{clientInsights[c.id]?.spend || '—'}</strong>Spesa</div>
                        <div style={{fontSize:11,color:'#8080a8'}}><strong style={{display:'block',fontSize:13,color:'#eef0f8'}}>{clientInsights[c.id]?.roas  || '—'}</strong>ROAS</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── CAMPAGNE ──────────────────────────────────────────────────── */}
          {page==='campagne' && (
            <div style={{background:'#09091a',border:'1px solid #1e1e30',borderRadius:12,overflow:'hidden'}}>
              <div style={{padding:'16px 20px',borderBottom:'1px solid #1e1e30',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                <div style={{fontSize:14,fontWeight:600}}>Tutte le Campagne <span style={{color:'#4d4d6e',fontWeight:400,fontSize:12}}>({campagne.length})</span></div>
                <div style={{display:'flex',gap:8}}>
                  <button onClick={syncCampaigns} style={btnSecondary}>⟳ Sync Meta</button>
                  <button onClick={() => { navigateToCrea(); setStep(1) }} style={btnPrimary}>+ Nuova</button>
                </div>
              </div>
              {campagne.length === 0 ? (
                <div style={{textAlign:'center',padding:60,color:'#4d4d6e'}}><div style={{fontSize:40,marginBottom:12}}>🚀</div><div style={{fontSize:13}}>Nessuna campagna ancora.</div></div>
              ) : (
                <table style={{width:'100%',borderCollapse:'collapse'}}>
                  <thead><tr>{['Campagna','Cliente','Obiettivo','Budget','Stato','Azioni'].map(h => <th key={h} style={{fontSize:11,color:'#4d4d6e',textTransform:'uppercase',letterSpacing:.5,padding:'10px 16px',textAlign:'left',borderBottom:'1px solid #1e1e30'}}>{h}</th>)}</tr></thead>
                  <tbody>{campagne.map(c => (
                    <tr key={c.id} style={{borderBottom:'1px solid #10101e'}}>
                      <td style={{padding:'12px 16px',fontSize:13,fontWeight:500}}>
                        <span onClick={()=>openCampaignBreakdown(c)} style={{cursor:'pointer',color:'#c0bcff',textDecoration:'underline',textDecorationStyle:'dotted'}}>{c.nome}</span>
                        {c.hasAd && <span style={{marginLeft:6,fontSize:10,color:'#22c55e',background:'rgba(34,197,94,.1)',padding:'1px 5px',borderRadius:4}}>completa</span>}
                        {c.hasAdSet && !c.hasAd && <span style={{marginLeft:6,fontSize:10,color:'#fbbf24',background:'rgba(245,158,11,.1)',padding:'1px 5px',borderRadius:4}}>no annuncio</span>}
                      </td>
                      <td style={{padding:'12px 16px',fontSize:13,color:'#8080a8'}}>{c.clienteName}</td>
                      <td style={{padding:'12px 16px',fontSize:13,color:'#8080a8'}}>{c.obiettivo?.replace('OUTCOME_','')}</td>
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
              {/* Draft banner — blocks the wizard until the user chooses */}
              {showDraftBanner ? (
                <div style={{maxWidth:520,margin:'60px auto 0',textAlign:'center'}}>
                  <div style={{fontSize:32,marginBottom:16}}>💾</div>
                  <div style={{fontSize:18,fontWeight:700,fontFamily:'Syne,sans-serif',marginBottom:8}}>Hai una bozza non completata</div>
                  <div style={{fontSize:13,color:'#8080a8',marginBottom:28}}>Vuoi continuare da dove ti eri fermato oppure ricominciare da zero?</div>
                  <div style={{display:'flex',gap:12,justifyContent:'center'}}>
                    <button onClick={resumeDraft} style={{...btnPrimary,padding:'10px 24px',fontSize:14,background:'#22c55e',borderRadius:10}}>Riprendi bozza</button>
                    <button onClick={clearDraft} style={{...btnDanger,padding:'10px 24px',fontSize:14,borderRadius:10}}>Elimina bozza</button>
                  </div>
                </div>
              ) : (
              <>
              {/* Auto-save indicator + clear button */}
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:16}}>
                <div style={{fontSize:11,color:'#3a3a58'}}>💾 Salvato automaticamente</div>
                {campForm.nome && <button onClick={clearDraft} style={{...btnSecondary,padding:'4px 10px',fontSize:11,color:'#4d4d6e'}}>✕ Cancella bozza</button>}
              </div>
              {/* Stepper */}
              <div style={{display:'flex',alignItems:'center',gap:0,marginBottom:28}}>
                {[1,2,3,4,5].map((s,i) => (
                  <div key={s} style={{display:'flex',alignItems:'center'}}>
                    <div style={{display:'flex',alignItems:'center',gap:8,fontSize:12,color:step===s?'#33d4ff':step>s?'#22c55e':'#4d4d6e'}}>
                      <div style={{width:24,height:24,borderRadius:'50%',border:'1.5px solid currentColor',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:600}}>{step>s?'✓':s}</div>
                      {['Obiettivo','Pubblico','Creatività','Budget','Lancio'][i]}
                    </div>
                    {i<4 && <div style={{flex:1,height:1,background:'#1e1e30',margin:'0 8px',width:30}}></div>}
                  </div>
                ))}
              </div>

              <div style={{background:'#09091a',border:'1px solid #1e1e30',borderRadius:12,padding:20,marginBottom:16}}>

                {/* Step 1 — Obiettivo */}
                {step===1 && (
                  <div>
                    <div style={{fontSize:14,fontWeight:600,marginBottom:16}}>Obiettivo della Campagna</div>
                    <div style={{marginBottom:14}}>
                      <label style={{fontSize:12,color:'#8080a8',display:'block',marginBottom:6}}>Nome Campagna</label>
                      <input value={campForm.nome} onChange={e=>setCampForm({...campForm,nome:e.target.value})} placeholder="es. Offerta Estate 2025" style={inputStyle} />
                    </div>
                    <div style={{marginBottom:14}}>
                      <label style={{fontSize:12,color:'#8080a8',display:'block',marginBottom:6}}>Cliente</label>
                      <select value={campForm.clienteId} onChange={e=>setCampForm({...campForm,clienteId:e.target.value})} style={inputStyle}>
                        <option value="">— Seleziona cliente —</option>
                        {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </div>
                    <label style={{fontSize:12,color:'#8080a8',display:'block',marginBottom:8}}>Obiettivo</label>
                    <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:8}}>
                      {objOptions.map(o => (
                        <div key={o.val} onClick={() => setCampForm({...campForm,obiettivo:o.val})} style={{padding:12,background:campForm.obiettivo===o.val?'rgba(0,200,255,.15)':'#10101e',border:campForm.obiettivo===o.val?'1px solid #00c8ff':'1px solid #1e1e30',borderRadius:8,cursor:'pointer',textAlign:'center'}}>
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

                    {/* Custom audiences */}
                    <div style={{marginBottom:16,padding:14,background:'#080712',border:'1px solid #1e1e30',borderRadius:10}}>
                      <div style={{fontSize:12,fontWeight:600,color:'#33d4ff',marginBottom:10}}>Pubblici Salvati</div>
                      {audiencesLoading ? (
                        <div style={{fontSize:12,color:'#4d4d6e'}}>⏳ Caricamento pubblici…</div>
                      ) : audiences.length > 0 ? (
                        <>
                          <select value={campForm.customAudienceId} onChange={e=>setCampForm({...campForm,customAudienceId:e.target.value})} style={inputStyle}>
                            <option value="">— Nessun pubblico salvato (usa targeting manuale) —</option>
                            {audiences.map(a => <option key={a.id} value={a.id}>{a.name} {a.subtype?`· ${a.subtype}`:''} {a.approximate_count_lower_bound?`(~${Number(a.approximate_count_lower_bound).toLocaleString()})`:''}</option>)}
                          </select>
                          <div style={{...helpText,marginTop:6}}>Se selezioni un pubblico salvato, sovrascrive le impostazioni di età/paese/interessi.</div>
                        </>
                      ) : (
                        <div style={{fontSize:12,color:'#4d4d6e'}}>{campForm.clienteId ? 'Nessun pubblico personalizzato trovato per questo account.' : 'Seleziona un cliente nello Step 1 per caricare i pubblici.'}</div>
                      )}
                    </div>

                    <div style={{fontSize:12,color:'#8080a8',marginBottom:10}}>— oppure targeting manuale —</div>
                    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
                      {[{label:'Età minima',key:'etaMin',type:'number'},{label:'Età massima',key:'etaMax',type:'number'},{label:'Paesi (es. IT,DE)',key:'paesi',type:'text'},{label:'Interessi',key:'interessi',type:'text'}].map(f => (
                        <div key={f.key}>
                          <label style={{fontSize:12,color:'#8080a8',display:'block',marginBottom:6}}>{f.label}</label>
                          <input type={f.type} value={campForm[f.key]} onChange={e=>setCampForm({...campForm,[f.key]:e.target.value})} style={inputStyle} />
                        </div>
                      ))}
                    </div>
                    <div style={{marginTop:12}}>
                      <label style={{fontSize:12,color:'#8080a8',display:'block',marginBottom:6}}>Genere</label>
                      <select value={campForm.genere} onChange={e=>setCampForm({...campForm,genere:e.target.value})} style={inputStyle}>
                        <option value="0">Tutti</option>
                        <option value="1">Solo uomini</option>
                        <option value="2">Solo donne</option>
                      </select>
                    </div>
                    <div style={{marginTop:12}}>
                      <label style={{fontSize:12,color:'#8080a8',display:'block',marginBottom:6}}>Posizionamenti</label>
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
                    <label style={{fontSize:12,color:'#8080a8',display:'block',marginBottom:8}}>Formato</label>
                    <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:8,marginBottom:16}}>
                      {fmtOptions.map(f => (
                        <div key={f.val} onClick={() => setCampForm({...campForm,formato:f.val})} style={{padding:10,background:campForm.formato===f.val?'rgba(0,200,255,.15)':'#10101e',border:campForm.formato===f.val?'1px solid #00c8ff':'1px solid #1e1e30',borderRadius:8,cursor:'pointer',textAlign:'center'}}>
                          <div style={{fontSize:16,marginBottom:3}}>{f.icon}</div>
                          <div style={{fontSize:11}}>{f.label}</div>
                        </div>
                      ))}
                    </div>

                    {/* Carousel builder */}
                    {campForm.formato === 'carousel' && (
                      <div style={{marginBottom:16}}>
                        <div style={{fontSize:13,fontWeight:600,marginBottom:10,color:'#e4e6f4'}}>Schede Carosello <span style={{fontSize:11,color:'#4d4d6e'}}>({carouselCards.length}/10)</span></div>
                        {carouselCards.map((card, idx) => (
                          <div key={card.id} style={{background:'#080712',border:'1px solid #1e1e30',borderRadius:8,padding:12,marginBottom:8}}>
                            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8}}>
                              <span style={{fontSize:11,color:'#4d4d6e',fontWeight:600}}>Scheda {idx+1}</span>
                              <button onClick={()=>removeCarouselCard(card.id)} style={{...btnDanger,padding:'2px 7px',fontSize:10}}>✕</button>
                            </div>
                            <div style={{display:'grid',gridTemplateColumns:'80px 1fr 1fr',gap:8,alignItems:'start'}}>
                              <label style={{display:'block',cursor:'pointer'}}>
                                {card.imagePreview
                                  ? <img src={card.imagePreview} style={{width:80,height:60,objectFit:'cover',borderRadius:6,display:'block'}} />
                                  : <div style={{width:80,height:60,background:'#10101e',border:'1px dashed #3a3a5e',borderRadius:6,display:'flex',alignItems:'center',justifyContent:'center',fontSize:18,color:'#4d4d6e'}}>+</div>
                                }
                                <input type="file" accept="image/*" style={{display:'none'}} onChange={e=>handleCarouselImageSelect(card.id, e.target.files?.[0])} />
                              </label>
                              <input value={card.title} onChange={e=>updateCarouselCard(card.id,'title',e.target.value)} placeholder="Titolo scheda" style={{...inputStyle,fontSize:12}} />
                              <input value={card.url} onChange={e=>updateCarouselCard(card.id,'url',e.target.value)} placeholder="URL scheda" style={{...inputStyle,fontSize:12}} />
                            </div>
                          </div>
                        ))}
                        <button onClick={addCarouselCard} style={{...btnSecondary,fontSize:12,width:'100%',marginTop:4}}>+ Aggiungi scheda</button>
                      </div>
                    )}

                    {/* Page selector */}
                    <div style={{marginBottom:16}}>
                      <label style={{fontSize:12,color:'#8080a8',display:'block',marginBottom:6}}>Pagina Facebook</label>
                      {pagesLoading ? (
                        <div style={{...inputStyle,color:'#4d4d6e',display:'flex',alignItems:'center',gap:8}}>
                          <span style={{fontSize:11}}>⏳</span> Caricamento pagine…
                        </div>
                      ) : availablePages.length > 0 ? (
                        <select
                          value={campForm.pageId}
                          onChange={e => setCampForm({...campForm, pageId: e.target.value})}
                          style={inputStyle}
                        >
                          <option value="">— Seleziona pagina —</option>
                          {availablePages.map(p => (
                            <option key={p.id} value={p.id}>{p.name}{p.category ? ` (${p.category})` : ''} · {p.id}</option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="text"
                          value={campForm.pageId}
                          onChange={e => setCampForm({...campForm, pageId: e.target.value})}
                          placeholder={campForm.clienteId ? 'Nessuna pagina trovata — inserisci ID manuale' : 'Seleziona prima un cliente (Step 1)'}
                          style={monoInputStyle}
                        />
                      )}
                      <div style={helpText}>
                        {availablePages.length > 0
                          ? `${availablePages.length} pagina/e trovata/e per questo account.`
                          : 'Ricaricata automaticamente quando selezioni il cliente. Inserisci l\'ID manuale come fallback.'}
                      </div>
                    </div>

                    {/* Format-specific image upload */}
                    {campForm.formato === 'image' && (
                      <div style={{marginBottom:14}}>
                        <div style={{fontSize:12,color:'#8080a8',marginBottom:10,fontWeight:600}}>Immagini creative</div>
                        {[
                          { slot:'square',   label:'Quadrata 1:1',   dims:'1080×1080px', desc:'Feed Facebook/Instagram' },
                          { slot:'vertical', label:'Verticale 4:5',  dims:'1080×1350px', desc:'Feed mobile' },
                          { slot:'stories',  label:'Stories 9:16',   dims:'1080×1920px', desc:'Stories & Reels' },
                        ].map(({ slot, label, dims, desc }) => (
                          <div key={slot} style={{display:'flex',alignItems:'center',gap:12,marginBottom:10,padding:10,background:'#080712',border:'1px solid #1e1e30',borderRadius:8}}>
                            <label style={{cursor:'pointer',flexShrink:0}}>
                              {multiImages[slot]?.preview
                                ? <img src={multiImages[slot].preview} style={{width:64,height:64,objectFit:'cover',borderRadius:6,display:'block'}} />
                                : <div style={{width:64,height:64,background:'#10101e',border:'1px dashed #3a3a5e',borderRadius:6,display:'flex',alignItems:'center',justifyContent:'center',fontSize:20,color:'#4d4d6e'}}>+</div>
                              }
                              <input type="file" accept="image/*" style={{display:'none'}} onChange={e => handleMultiImageSelect(slot, e.target.files?.[0])} />
                            </label>
                            <div style={{flex:1,minWidth:0}}>
                              <div style={{fontSize:12,fontWeight:600,color:'#e4e6f4'}}>{label}</div>
                              <div style={{fontSize:11,color:'#4d4d6e'}}>{dims} · {desc}</div>
                              {multiImages[slot] && (
                                <button onClick={() => setMultiImages(p => ({ ...p, [slot]: null }))} style={{...btnDanger,padding:'2px 7px',fontSize:10,marginTop:4}}>✕ Rimuovi</button>
                              )}
                            </div>
                          </div>
                        ))}
                        <div style={helpText}>Almeno una immagine richiesta. Priorità: quadrata → verticale → stories.</div>
                      </div>
                    )}

                    {campForm.formato === 'video' && (
                      <div style={{marginBottom:14}}>
                        <label style={{fontSize:12,color:'#8080a8',display:'block',marginBottom:6}}>Video creativo</label>
                        <label style={{display:'block',border:'1px dashed #3a3a5e',borderRadius:8,padding:videoPreview?0:20,textAlign:'center',cursor:'pointer',background:'#10101e',overflow:'hidden'}}>
                          {videoPreview
                            ? <video src={videoPreview} controls style={{width:'100%',maxHeight:200,display:'block'}} />
                            : <div style={{color:'#4d4d6e',fontSize:12}}>
                                <div style={{fontSize:24,marginBottom:6}}>🎬</div>
                                Clicca per caricare un video (MP4 — max 4 GB)
                              </div>
                          }
                          <input type="file" accept="video/*" style={{display:'none'}} onChange={e => handleVideoSelect(e.target.files?.[0])} />
                        </label>
                        {videoPreview && <button onClick={() => { setVideoFile(null); setVideoPreview(null) }} style={{...btnDanger,marginTop:6,fontSize:11}}>✕ Rimuovi video</button>}
                      </div>
                    )}

                    {campForm.formato === 'collection' && (
                      <div style={{marginBottom:14}}>
                        <div style={{fontSize:12,color:'#8080a8',marginBottom:10,fontWeight:600}}>Immagine di copertina</div>
                        <div style={{display:'flex',alignItems:'center',gap:12,padding:10,background:'#080712',border:'1px solid #1e1e30',borderRadius:8,marginBottom:8}}>
                          <label style={{cursor:'pointer',flexShrink:0}}>
                            {multiImages.square?.preview
                              ? <img src={multiImages.square.preview} style={{width:64,height:64,objectFit:'cover',borderRadius:6,display:'block'}} />
                              : <div style={{width:64,height:64,background:'#10101e',border:'1px dashed #3a3a5e',borderRadius:6,display:'flex',alignItems:'center',justifyContent:'center',fontSize:20,color:'#4d4d6e'}}>+</div>
                            }
                            <input type="file" accept="image/*" style={{display:'none'}} onChange={e => handleMultiImageSelect('square', e.target.files?.[0])} />
                          </label>
                          <div style={{flex:1}}>
                            <div style={{fontSize:12,fontWeight:600,color:'#e4e6f4'}}>Copertina Collection</div>
                            <div style={{fontSize:11,color:'#4d4d6e'}}>1200×628px consigliato</div>
                            {multiImages.square && <button onClick={() => setMultiImages(p => ({ ...p, square: null }))} style={{...btnDanger,padding:'2px 7px',fontSize:10,marginTop:4}}>✕ Rimuovi</button>}
                          </div>
                        </div>
                        <div style={{padding:'10px 14px',background:'rgba(0,200,255,.08)',border:'1px solid rgba(0,200,255,.2)',borderRadius:8,fontSize:11,color:'#33d4ff'}}>ℹ I prodotti della collection vengono gestiti direttamente dal catalogo Meta collegato all'ad account.</div>
                      </div>
                    )}

                    {[{label:'Testo principale',key:'adText',tag:'textarea'},{label:'Titolo (Headline)',key:'adHeadline'},{label:'Descrizione',key:'adDesc'},{label:'URL di destinazione',key:'adUrl'}].map(f => (
                      <div key={f.key} style={{marginBottom:12}}>
                        <label style={{fontSize:12,color:'#8080a8',display:'block',marginBottom:6}}>{f.label}</label>
                        {f.tag==='textarea'
                          ? <textarea value={campForm[f.key]} onChange={e=>setCampForm({...campForm,[f.key]:e.target.value})} style={{...inputStyle,minHeight:70,resize:'vertical'}} />
                          : <input value={campForm[f.key]} onChange={e=>setCampForm({...campForm,[f.key]:e.target.value})} style={inputStyle} />
                        }
                      </div>
                    ))}
                    <label style={{fontSize:12,color:'#8080a8',display:'block',marginBottom:6}}>Call to Action</label>
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
                        <label style={{fontSize:12,color:'#8080a8',display:'block',marginBottom:6}}>Tipo budget</label>
                        <select value={campForm.budgetType} onChange={e=>setCampForm({...campForm,budgetType:e.target.value})} style={inputStyle}>
                          <option value="DAILY">Giornaliero</option>
                          <option value="LIFETIME">Totale</option>
                        </select>
                      </div>
                      <div>
                        <label style={{fontSize:12,color:'#8080a8',display:'block',marginBottom:6}}>Importo (€)</label>
                        <input type="number" value={campForm.budget} onChange={e=>setCampForm({...campForm,budget:e.target.value})} style={inputStyle} />
                      </div>
                    </div>
                    <div style={{display:'grid',gridTemplateColumns:'1fr auto',gap:8,marginBottom:12,alignItems:'end'}}>
                      <div>
                        <label style={{fontSize:12,color:'#8080a8',display:'block',marginBottom:6}}>Data inizio</label>
                        <input type="date" value={campForm.startDate} onChange={e=>setCampForm({...campForm,startDate:e.target.value})} style={inputStyle} />
                      </div>
                      <div>
                        <label style={{fontSize:12,color:'#8080a8',display:'block',marginBottom:6}}>Orario</label>
                        <input type="time" value={campForm.startTime} onChange={e=>setCampForm({...campForm,startTime:e.target.value})} style={{...inputStyle,width:100}} />
                      </div>
                    </div>
                    <div>
                      <label style={{fontSize:12,color:'#8080a8',display:'block',marginBottom:6}}>Data fine</label>
                      <input
                        type="date"
                        value={campForm.endDate}
                        disabled={campForm.noEndDate}
                        onChange={e=>setCampForm({...campForm,endDate:e.target.value})}
                        style={{...inputStyle,opacity:campForm.noEndDate?.5:1,marginBottom:8}}
                      />
                      <label style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer',fontSize:12,color:'#8080a8'}}>
                        <input
                          type="checkbox"
                          checked={campForm.noEndDate}
                          onChange={e=>setCampForm({...campForm,noEndDate:e.target.checked,endDate:e.target.checked?'':campForm.endDate})}
                          style={{accentColor:'#00c8ff',width:14,height:14}}
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

                  const isCarousel = campForm.formato === 'carousel'
                  const fbFeedImg  = multiImages.square?.preview || multiImages.vertical?.preview || null
                  const igFeedImg  = multiImages.square?.preview || multiImages.vertical?.preview || null
                  const igStoryImg = multiImages.stories?.preview || multiImages.vertical?.preview || null

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
                      {isCarousel ? (
                        <div style={{display:'flex',overflowX:'auto',gap:0,borderTop:'1px solid #e4e6eb'}}>
                          {carouselCards.map((card,i) => (
                            <div key={card.id} style={{flexShrink:0,width:160,borderRight:'1px solid #e4e6eb'}}>
                              {card.imagePreview ? <img src={card.imagePreview} style={{width:'100%',height:160,objectFit:'cover',display:'block'}} /> : <div style={{height:160,background:'#e4e6ea',display:'flex',alignItems:'center',justifyContent:'center',fontSize:24,color:'#bec3c9'}}>🖼️</div>}
                              <div style={{background:'#f0f2f5',padding:'6px 8px'}}>
                                <div style={{fontSize:12,fontWeight:700,color:'#050505',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{card.title || ph(`Card ${i+1}`)}</div>
                                <button style={{marginTop:4,padding:'4px 8px',background:'#e4e6ea',border:'none',borderRadius:4,fontSize:10,fontWeight:600,color:'#050505',cursor:'default',width:'100%'}}>{ctaLabel}</button>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <>
                          {fbFeedImg ? <img src={fbFeedImg} alt="ad" style={{width:'100%',height:300,objectFit:'cover',display:'block'}} /> : <div style={{height:300,background:'#e4e6ea',display:'flex',alignItems:'center',justifyContent:'center',fontSize:32,color:'#bec3c9'}}>🖼️</div>}
                          <div style={{background:'#f0f2f5',padding:'8px 12px',display:'flex',alignItems:'center',gap:8}}>
                            <div style={{flex:1,minWidth:0}}>
                              {displayUrl ? <div style={{fontSize:11,color:'#65676b',marginBottom:1,textTransform:'uppercase',letterSpacing:.3,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{displayUrl}</div> : ph('TUOSITO.COM')}
                              <div style={{fontSize:13,fontWeight:700,color:'#050505',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{headline || ph('Headline dell\'annuncio')}</div>
                              {adDesc && <div style={{fontSize:12,color:'#65676b',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{adDesc}</div>}
                            </div>
                            <button style={{padding:'6px 10px',background:'#e4e6ea',border:'none',borderRadius:6,fontSize:12,fontWeight:600,color:'#050505',cursor:'default',flexShrink:0,whiteSpace:'nowrap'}}>{ctaLabel}</button>
                          </div>
                        </>
                      )}
                      <div style={{padding:'6px 12px',borderTop:'1px solid #e4e6eb',display:'flex',gap:14,fontSize:12,color:'#65676b'}}>
                        <span>👍 Mi piace</span><span>💬 Commenta</span><span>↗ Condividi</span>
                      </div>
                    </div>
                  )

                  const IgStoriesPreview = () => (
                    <div style={{background:'#000',borderRadius:14,overflow:'hidden',width:220,height:390,position:'relative',boxShadow:'0 2px 16px rgba(0,0,0,.55)',fontFamily:'system-ui,-apple-system,sans-serif'}}>
                      {igStoryImg
                        ? <img src={igStoryImg} alt="ad" style={{position:'absolute',inset:0,width:'100%',height:'100%',objectFit:'cover'}} />
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
                      {igFeedImg
                        ? <img src={igFeedImg} alt="ad" style={{width:'100%',height:320,objectFit:'cover',display:'block'}} />
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
                        <div key={r.l}><div style={{fontSize:11,color:'#4d4d6e',marginBottom:4}}>{r.l.toUpperCase()}</div><div style={{fontWeight:500,fontSize:13}}>{r.v}</div></div>
                      ))}
                    </div>

                    {/* Format tabs + preview */}
                    <div style={{marginBottom:16}}>
                      <div style={{fontSize:11,color:'#4d4d6e',marginBottom:8,textTransform:'uppercase',letterSpacing:.5}}>Preview Inserzione</div>
                      {/* Tab selector */}
                      <div style={{display:'flex',gap:4,marginBottom:14,background:'#06060b',padding:3,borderRadius:8,width:'fit-content'}}>
                        {fmtTabs.map(t => (
                          <button key={t.id} onClick={()=>setPreviewFormat(t.id)} style={{padding:'5px 12px',borderRadius:6,border:'none',fontSize:11,fontWeight:600,cursor:'pointer',background:previewFormat===t.id?'#1e1e30':'transparent',color:previewFormat===t.id?'#c0bcff':'#4d4d6e',transition:'all .15s'}}>
                            {t.label}
                          </button>
                        ))}
                      </div>
                      {previewFormat==='fb_feed'    && <FbFeedPreview />}
                      {previewFormat==='ig_stories' && <IgStoriesPreview />}
                      {previewFormat==='ig_feed'    && <IgFeedPreview />}
                    </div>

                    {campForm.formato === 'image' && !multiImages.square && !multiImages.vertical && !multiImages.stories && (
                      <div style={{padding:'10px 14px',background:'rgba(245,158,11,.08)',border:'1px solid rgba(245,158,11,.2)',borderRadius:8,fontSize:12,color:'#fbbf24'}}>⚠ Nessuna immagine caricata — verrà creata la campagna e l'Ad Set, ma non l'annuncio.</div>
                    )}
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
              </>
              )}
            </div>
          )}

          {/* ── REGOLE ────────────────────────────────────────────────────── */}
          {page==='regole' && (
            <div>
              <div style={{padding:'12px 16px',background:'rgba(0,200,255,.1)',border:'1px solid rgba(0,200,255,.3)',borderRadius:8,color:'#33d4ff',fontSize:13,marginBottom:16}}>ℹ Le regole attive vengono eseguite ogni ora dal backend Railway — anche quando questa pagina è chiusa.</div>
              <div style={{display:'flex',justifyContent:'flex-end',marginBottom:16}}>
                <button onClick={()=>setModalRule(true)} style={btnPrimary}>+ Aggiungi Regola</button>
              </div>
              {rules.map(r => (
                <div key={r.id} style={{display:'flex',alignItems:'center',gap:12,background:'#10101e',border:'1px solid #1e1e30',borderRadius:8,padding:'14px 16px',marginBottom:8}}>
                  <div style={{width:32,height:32,borderRadius:8,background:r.color,display:'flex',alignItems:'center',justifyContent:'center',fontSize:14,flexShrink:0}}>{r.icon}</div>
                  <div style={{flex:1}}>
                    <div style={{fontSize:13,fontWeight:500}}>{r.name}</div>
                    <div style={{fontSize:11,color:'#4d4d6e',marginTop:2}}>{r.desc}</div>
                  </div>
                  <div onClick={() => toggleRule(r.id)} style={{width:36,height:20,background:r.on?'#00c8ff':'#1e1e30',borderRadius:10,position:'relative',cursor:'pointer',transition:'background .2s',flexShrink:0}}>
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
                  <div key={r.t} style={{background:'#09091a',border:'1px solid #1e1e30',borderRadius:12,padding:16}}>
                    <div style={{fontSize:14,fontWeight:600,marginBottom:6}}>{r.t}</div>
                    <div style={{fontSize:12,color:'#4d4d6e',marginBottom:12}}>{r.d}</div>
                    <div style={{display:'flex',gap:6}}>
                      <button onClick={() => generateReport(r.type)} disabled={!!reportLoading} style={{...btnSecondary,flex:1,padding:'7px',fontSize:11,opacity:reportLoading===r.type?.6:1}}>
                        {reportLoading===r.type ? '⏳...' : '⬇ CSV'}
                      </button>
                      <button onClick={() => generatePDF(r.type)} disabled={!!reportLoading} style={{...btnPrimary,flex:1,padding:'7px',fontSize:11,opacity:reportLoading===r.type+'_pdf'?.6:1}}>
                        {reportLoading===r.type+'_pdf' ? '⏳...' : '📄 PDF'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <div style={{background:'#09091a',border:'1px solid #1e1e30',borderRadius:12,padding:20}}>
                <div style={{fontSize:14,fontWeight:600,marginBottom:12}}>Metriche incluse nel report</div>
                <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:8}}>
                  {['Spesa','ROAS','CPC','CTR','CPM','CPA','Impression','Reach','Click','Conversioni','Frequenza','Qualità'].map(m=>(
                    <div key={m} style={{fontSize:12,padding:8,background:'#10101e',borderRadius:8,textAlign:'center',color:'#8080a8'}}>{m}</div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── IMPOSTAZIONI ──────────────────────────────────────────────── */}
          {page==='impostazioni' && (
            <div>
              <div style={{background:'#09091a',border:'1px solid #1e1e30',borderRadius:12,padding:20,marginBottom:16}}>
                <div style={{fontSize:14,fontWeight:600,marginBottom:4}}>Informazioni Agenzia</div>
                <div style={{fontSize:12,color:'#4d4d6e',marginBottom:14}}>Salvate localmente nel tuo browser</div>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:14}}>
                  <div><label style={{fontSize:12,color:'#8080a8',display:'block',marginBottom:6}}>Nome Agenzia</label><input value={settForm.agencyName} onChange={e=>setSettForm({...settForm,agencyName:e.target.value})} placeholder="Digital Agency SRL" style={inputStyle} /></div>
                  <div><label style={{fontSize:12,color:'#8080a8',display:'block',marginBottom:6}}>Email</label><input value={settForm.email} onChange={e=>setSettForm({...settForm,email:e.target.value})} placeholder="info@agenzia.it" style={inputStyle} /></div>
                </div>
                <button onClick={saveSettingsForm} style={btnPrimary}>Salva</button>
              </div>

              <div style={{background:'#09091a',border:'1px solid #1e1e30',borderRadius:12,padding:20,marginBottom:16}}>
                <div style={{fontSize:14,fontWeight:600,marginBottom:4}}>Connessione Meta API</div>
                <div style={{fontSize:12,color:'#4d4d6e',marginBottom:16}}>Ogni utente inserisce le proprie credenziali — i dati restano nel tuo browser</div>

                <div style={{background:'#080712',border:'1px solid #1e1e30',borderRadius:10,padding:16,marginBottom:20}}>
                  <div style={{fontSize:12,fontWeight:600,color:'#33d4ff',marginBottom:14,letterSpacing:.3}}>Come configurare AdFlow — 3 passi</div>
                  <div style={{display:'flex',flexDirection:'column',gap:12}}>
                    {[
                      { n:1, title:'Crea l\'app Meta', body: <>Vai su <a href="https://developers.facebook.com/apps" target="_blank" rel="noreferrer" style={{color:'#33d4ff',textDecoration:'none'}}>developers.facebook.com/apps</a> → clicca <strong style={{color:'#8080a8'}}>Crea app</strong> → scegli tipo <strong style={{color:'#8080a8'}}>Business</strong> → copia l'<strong style={{color:'#8080a8'}}>App ID</strong> dalla dashboard.</> },
                      { n:2, title:'Crea l\'utente di sistema e genera il token', body: <>Vai su <a href="https://business.facebook.com/settings" target="_blank" rel="noreferrer" style={{color:'#33d4ff',textDecoration:'none'}}>business.facebook.com/settings</a> → <strong style={{color:'#8080a8'}}>Utenti → Utenti di sistema → Aggiungi</strong> con ruolo Admin → assegna gli ad account → <strong style={{color:'#8080a8'}}>Genera token</strong> con permessi <strong style={{color:'#8080a8'}}>ads_management</strong> e <strong style={{color:'#8080a8'}}>ads_read</strong>.</> },
                      { n:3, title:'Trova il Business Manager ID', body: <>Sempre su <a href="https://business.facebook.com/settings" target="_blank" rel="noreferrer" style={{color:'#33d4ff',textDecoration:'none'}}>business.facebook.com/settings</a> → <strong style={{color:'#8080a8'}}>Informazioni business</strong>. Il numero ID è in cima alla pagina.</> },
                    ].map((s, i, arr) => (
                      <div key={s.n}>
                        <div style={{display:'flex',gap:12,alignItems:'flex-start'}}>
                          <div style={{width:24,height:24,borderRadius:'50%',background:'rgba(0,200,255,.25)',color:'#33d4ff',fontSize:11,fontWeight:700,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,marginTop:1}}>{s.n}</div>
                          <div>
                            <div style={{fontSize:12,fontWeight:600,color:'#e4e6f4',marginBottom:3}}>{s.title}</div>
                            <div style={{fontSize:11,color:'#4d4d6e',lineHeight:1.6}}>{s.body}</div>
                          </div>
                        </div>
                        {i < arr.length - 1 && <div style={{borderTop:'1px solid #1e1e2e',marginTop:12}}></div>}
                      </div>
                    ))}
                  </div>
                </div>

                <div style={{marginBottom:14}}>
                  <label style={{fontSize:12,color:'#8080a8',display:'block',marginBottom:6}}>App ID Meta</label>
                  <input type="text" value={settForm.appId} onChange={e=>setSettForm({...settForm,appId:e.target.value})} placeholder="Es. 1234567890123456" style={monoInputStyle} />
                  <div style={helpText}>L'ID della tua app Meta (step 1). Lo trovi nella dashboard di <a href="https://developers.facebook.com/apps" target="_blank" rel="noreferrer" style={{color:'#00c8ff',textDecoration:'none'}}>developers.facebook.com</a>.</div>
                </div>
                <div style={{marginBottom:14}}>
                  <label style={{fontSize:12,color:'#8080a8',display:'block',marginBottom:6}}>System User Token</label>
                  <input type={!tokenVisible?'password':'text'} value={settForm.token} onChange={e=>setSettForm({...settForm,token:e.target.value})} placeholder="Token generato nello step 2…" style={monoInputStyle} />
                  <div style={helpText}>Il token che autorizza AdFlow a gestire le campagne (step 2). Copialo subito — non viene mostrato di nuovo.</div>
                </div>
                <div style={{marginBottom:16}}>
                  <label style={{fontSize:12,color:'#8080a8',display:'block',marginBottom:6}}>Business Manager ID</label>
                  <input type="text" value={settForm.bmId} onChange={e=>setSettForm({...settForm,bmId:e.target.value})} placeholder="Es. 123456789012345" style={monoInputStyle} />
                  <div style={helpText}>Il numero ID del tuo Business Manager (step 3). Solo cifre, tipo <em>123456789012345</em>.</div>
                </div>

                <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
                  <button onClick={saveSettingsForm} style={btnPrimary}>Salva Credenziali</button>
                  <button onClick={()=>setTokenVisible(!tokenVisible)} style={btnSecondary}>{tokenVisible?'Nascondi Token':'Mostra Token'}</button>
                  <button onClick={testConnection} style={btnSecondary}>Testa Connessione</button>
                  {connStatus && <span style={{fontSize:12,color:connStatus.includes('✅')?'#22c55e':connStatus.includes('❌')?'#ef4444':'#8080a8'}}>{connStatus}</span>}
                </div>
              </div>
            </div>
          )}

        </div>
      </main>

      {/* ── MODAL CLIENTE (aggiungi / modifica) ──────────────────────────── */}
      {(modalClient || editingClient) && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.7)',zIndex:100,display:'flex',alignItems:'center',justifyContent:'center'}}>
          <div style={{background:'#09091a',border:'1px solid #3a3a4e',borderRadius:16,padding:24,width:520,maxWidth:'95vw',maxHeight:'85vh',overflowY:'auto'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20}}>
              <div style={{fontFamily:'Syne,sans-serif',fontSize:16,fontWeight:700}}>{editingClient ? 'Modifica Cliente' : 'Aggiungi Cliente'}</div>
              <button onClick={() => { setModalClient(false); setEditingClient(null); setClientForm({ name:'', adAccount:'', pageId:'', sector:'E-commerce', notes:'' }) }} style={{background:'none',border:'none',color:'#4d4d6e',cursor:'pointer',fontSize:18}}>✕</button>
            </div>
            <div style={{marginBottom:14}}>
              <label style={{fontSize:12,color:'#8080a8',display:'block',marginBottom:6}}>Nome Cliente / Azienda</label>
              <input value={clientForm.name} onChange={e=>setClientForm({...clientForm,name:e.target.value})} placeholder="Es. Rossini Srl" style={inputStyle} />
            </div>
            <div style={{marginBottom:14}}>
              <label style={{fontSize:12,color:'#8080a8',display:'block',marginBottom:6}}>Ad Account ID</label>
              <input value={clientForm.adAccount} onChange={e=>setClientForm({...clientForm,adAccount:e.target.value})} placeholder="act_123456789" style={monoInputStyle} />
              <div style={helpText}>Formato <strong style={{color:'#8080a8'}}>act_</strong> + numero. Trovalo in Business Manager → Account pubblicitari.</div>
            </div>
            <div style={{marginBottom:14}}>
              <label style={{fontSize:12,color:'#8080a8',display:'block',marginBottom:6}}>Pagina Facebook ID</label>
              <input value={clientForm.pageId} onChange={e=>setClientForm({...clientForm,pageId:e.target.value})} placeholder="123456789 (opzionale — caricato automaticamente)" style={monoInputStyle} />
              <div style={helpText}>AdFlow carica automaticamente le pagine disponibili dall'Ad Account nel wizard di creazione campagna. Inserisci qui l'ID solo come fallback manuale se il caricamento automatico non funziona. Trovalo nell'URL della pagina Facebook o in Business Manager.</div>
            </div>
            <div style={{marginBottom:14}}>
              <label style={{fontSize:12,color:'#8080a8',display:'block',marginBottom:6}}>Settore</label>
              <select value={clientForm.sector} onChange={e=>setClientForm({...clientForm,sector:e.target.value})} style={inputStyle}>
                {['E-commerce','Ristorazione','Immobiliare','Salute & Benessere','Moda & Lifestyle','B2B / Servizi','Turismo','Altro'].map(s=><option key={s}>{s}</option>)}
              </select>
            </div>
            <div style={{marginBottom:20}}>
              <label style={{fontSize:12,color:'#8080a8',display:'block',marginBottom:6}}>Note</label>
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
          <div style={{background:'#09091a',border:'1px solid #3a3a4e',borderRadius:16,padding:24,width:480,maxWidth:'95vw'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20}}>
              <div style={{fontFamily:'Syne,sans-serif',fontSize:16,fontWeight:700}}>Nuova Regola Automatica</div>
              <button onClick={()=>setModalRule(false)} style={{background:'none',border:'none',color:'#4d4d6e',cursor:'pointer',fontSize:18}}>✕</button>
            </div>
            {[
              {label:'Nome regola',    key:'name',      tag:'input',  placeholder:'Es. Pausa se CPA alto'},
              {label:'Condizione',     key:'condition', tag:'select', opts:[{v:'cpa_gt',l:'CPA maggiore di'},{v:'roas_gt',l:'ROAS maggiore di'},{v:'ctr_lt',l:'CTR minore di'},{v:'spend_gt',l:'Spesa maggiore di'}]},
              {label:'Valore soglia',  key:'value',     tag:'input',  type:'number', placeholder:'Es. 10'},
              {label:'Azione',         key:'action',    tag:'select', opts:[{v:'pause',l:'Metti in pausa'},{v:'budget_increase',l:'Aumenta budget 20%'},{v:'budget_decrease',l:'Riduci budget 20%'},{v:'notify',l:'Solo notifica'}]},
            ].map(f=>(
              <div key={f.key} style={{marginBottom:14}}>
                <label style={{fontSize:12,color:'#8080a8',display:'block',marginBottom:6}}>{f.label}</label>
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

      {/* ── MODAL BREAKDOWN CAMPAGNA ─────────────────────────────────────── */}
      {selectedCampaign && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.75)',zIndex:100,display:'flex',alignItems:'center',justifyContent:'center'}} onClick={()=>setSelectedCampaign(null)}>
          <div style={{background:'#09091a',border:'1px solid #3a3a4e',borderRadius:16,padding:24,width:580,maxWidth:'95vw',maxHeight:'85vh',overflowY:'auto'}} onClick={e=>e.stopPropagation()}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
              <div>
                <div style={{fontFamily:'Syne,sans-serif',fontSize:15,fontWeight:700}}>{selectedCampaign.nome}</div>
                <div style={{fontSize:11,color:'#4d4d6e',marginTop:2}}>{selectedCampaign.clienteName} · {selectedCampaign.obiettivo?.replace('OUTCOME_','')}</div>
              </div>
              <button onClick={()=>setSelectedCampaign(null)} style={{background:'none',border:'none',color:'#4d4d6e',cursor:'pointer',fontSize:18}}>✕</button>
            </div>

            {!selectedCampaign.fromMeta ? (
              <div style={{color:'#4d4d6e',fontSize:13}}>Breakdown disponibile solo per campagne sincronizzate da Meta.</div>
            ) : breakdownLoading ? (
              <div style={{color:'#4d4d6e',fontSize:13,padding:'20px 0',textAlign:'center'}}>⏳ Caricamento breakdown...</div>
            ) : (
              <>
                {/* Tabs */}
                <div style={{display:'flex',gap:4,marginBottom:16,background:'#06060b',padding:3,borderRadius:8,width:'fit-content'}}>
                  {[{id:'age',l:'Età'},{id:'gender',l:'Sesso'},{id:'placement',l:'Placement'}].map(t=>(
                    <button key={t.id} onClick={()=>setBreakdownTab(t.id)} style={{padding:'5px 14px',borderRadius:6,border:'none',fontSize:11,fontWeight:600,cursor:'pointer',background:breakdownTab===t.id?'#1e1e30':'transparent',color:breakdownTab===t.id?'#c0bcff':'#4d4d6e'}}>
                      {t.l}
                    </button>
                  ))}
                </div>
                {/* Table */}
                {(() => {
                  const rows = breakdownData[breakdownTab] || []
                  if (!rows.length) return <div style={{color:'#4d4d6e',fontSize:12}}>Nessun dato disponibile.</div>
                  const keyLabel = breakdownTab === 'age' ? 'age' : breakdownTab === 'gender' ? 'gender' : 'publisher_platform'
                  return (
                    <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                      <thead><tr>{[breakdownTab==='age'?'Fascia età':breakdownTab==='gender'?'Sesso':'Placement','Spesa','Impression','Click','CTR'].map(h=><th key={h} style={{textAlign:'left',padding:'6px 8px',color:'#4d4d6e',fontSize:11,borderBottom:'1px solid #1e1e30'}}>{h}</th>)}</tr></thead>
                      <tbody>{rows.map((r,i)=>(
                        <tr key={i} style={{borderBottom:'1px solid #10101e'}}>
                          <td style={{padding:'7px 8px',fontWeight:500}}>{r[keyLabel] || '—'}</td>
                          <td style={{padding:'7px 8px',color:'#8080a8'}}>€{parseFloat(r.spend||0).toFixed(2)}</td>
                          <td style={{padding:'7px 8px',color:'#8080a8'}}>{r.impressions||0}</td>
                          <td style={{padding:'7px 8px',color:'#8080a8'}}>{r.clicks||0}</td>
                          <td style={{padding:'7px 8px',color:'#8080a8'}}>{r.ctr?parseFloat(r.ctr).toFixed(2)+'%':'—'}</td>
                        </tr>
                      ))}</tbody>
                    </table>
                  )
                })()}
              </>
            )}
          </div>
        </div>
      )}

      {/* ── NOTIFICA ─────────────────────────────────────────────────────── */}
      {showNotif && (
        <div style={{position:'fixed',bottom:24,right:24,background:'#10101e',border:'1px solid #3a3a4e',borderLeft:'3px solid #00c8ff',borderRadius:12,padding:'14px 18px',fontSize:13,zIndex:200,maxWidth:320}}>
          {notif}
        </div>
      )}
    </div>
  )
}
