import { useState, useEffect } from 'react'
import './App.css'

const COLORS = ['#6c63ff','#22c55e','#f59e0b','#ef4444','#3b82f6','#ec4899','#14b8a6']
const API = import.meta.env.VITE_API_URL || ''

function getClients() { return JSON.parse(localStorage.getItem('adflow_clients') || '[]') }
function saveClients(c) { localStorage.setItem('adflow_clients', JSON.stringify(c)) }
function getCampagne() { return JSON.parse(localStorage.getItem('adflow_campagne') || '[]') }
function saveCampagne(c) { localStorage.setItem('adflow_campagne', JSON.stringify(c)) }
function getSettings() { return JSON.parse(localStorage.getItem('adflow_settings') || '{}') }
function saveSettings(s) { localStorage.setItem('adflow_settings', JSON.stringify(s)) }

export default function App() {
  const [page, setPage] = useState('dashboard')
  const [clients, setClients] = useState(getClients())
  const [campagne, setCampagne] = useState(getCampagne())
  const [settings, setSettings] = useState(getSettings())
  const [notif, setNotif] = useState('')
  const [showNotif, setShowNotif] = useState(false)
  const [modalClient, setModalClient] = useState(false)
  const [modalRule, setModalRule] = useState(false)
  const [step, setStep] = useState(1)
  const [tokenVisible, setTokenVisible] = useState(false)
  const [connStatus, setConnStatus] = useState('')

  const [campForm, setCampForm] = useState({
    nome:'', clienteId:'', obiettivo:'OUTCOME_TRAFFIC', formato:'image',
    etaMin:'18', etaMax:'45', genere:'0', paesi:'IT', interessi:'',
    placement:'automatic', adText:'', adHeadline:'', adDesc:'', adUrl:'',
    adCta:'LEARN_MORE', budgetType:'DAILY', budget:'10',
    startDate: new Date().toISOString().split('T')[0], endDate:'', bidStrategy:'LOWEST_COST_WITHOUT_CAP'
  })

  const [clientForm, setClientForm] = useState({ name:'', adAccount:'', pageId:'', sector:'E-commerce', notes:'' })
  const [settForm, setSettForm] = useState({ agencyName: settings.agencyName||'', email: settings.email||'', token: settings.token||'', bmId: settings.bmId||'', appId: settings.appId||'' })
  const [rules, setRules] = useState([
    { id:1, name:'Pausa se CPA > soglia', desc:'Mette in pausa il gruppo annunci se il CPA supera il limite', on:false, icon:'⏸', color:'rgba(239,68,68,.15)' },
    { id:2, name:'Scala budget se ROAS alto', desc:'Aumenta il budget del 20% se ROAS > 3x per 3 giorni', on:true, icon:'📈', color:'rgba(34,197,94,.15)' },
    { id:3, name:'Alerta spesa giornaliera', desc:'Notifica quando la spesa supera il 90% del budget', on:true, icon:'💰', color:'rgba(245,158,11,.15)' },
    { id:4, name:'Pausa se CTR < 0.5%', desc:'Sospende annunci con CTR troppo basso dopo 1000 impression', on:false, icon:'📉', color:'rgba(108,99,255,.15)' },
  ])
  const [ruleForm, setRuleForm] = useState({ name:'', condition:'cpa_gt', value:'', action:'pause' })

  function notify(msg) { setNotif(msg); setShowNotif(true); setTimeout(() => setShowNotif(false), 3000) }

  function saveClient() {
    if (!clientForm.name) { notify('Inserisci il nome del cliente'); return }
    const updated = [...clients, { ...clientForm, id: Date.now().toString(), createdAt: new Date().toISOString() }]
    saveClients(updated); setClients(updated); setModalClient(false)
    setClientForm({ name:'', adAccount:'', pageId:'', sector:'E-commerce', notes:'' })
    notify('Cliente aggiunto!')
  }

  function saveRule() {
    if (!ruleForm.name) { notify('Inserisci il nome della regola'); return }
    const condLabels = { cpa_gt:'CPA >', roas_gt:'ROAS >', ctr_lt:'CTR <', spend_gt:'Spesa >', cpc_gt:'CPC >' }
    const actLabels = { pause:'Metti in pausa', budget_increase:'Aumenta budget 20%', budget_decrease:'Riduci budget 20%', notify:'Solo notifica' }
    setRules([...rules, { id: Date.now(), name: ruleForm.name, desc: `${condLabels[ruleForm.condition]} ${ruleForm.value} → ${actLabels[ruleForm.action]}`, on: false, icon:'⚡', color:'rgba(108,99,255,.15)' }])
    setModalRule(false); setRuleForm({ name:'', condition:'cpa_gt', value:'', action:'pause' })
    notify('Regola aggiunta!')
  }

  function lanciaCampagna() {
    if (!campForm.nome) { notify('Inserisci il nome della campagna'); return }
    if (!campForm.clienteId) { notify('Seleziona un cliente'); return }
    if (!settings.token) { notify('⚠ Token non configurato. Vai in Impostazioni.'); return }
    const client = clients.find(c => c.id === campForm.clienteId)
    if (!client?.adAccount) {
      notify('⚠ Il cliente non ha un Ad Account ID configurato')
      return
    }
    notify('Creazione campagna su Meta...')
    fetch(`${API}/api/campaigns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...metaHeaders() },
      body: JSON.stringify({
        account_id: client.adAccount,
        name: campForm.nome,
        objective: campForm.obiettivo,
        daily_budget: campForm.budgetType === 'DAILY' ? Number(campForm.budget) : undefined,
        lifetime_budget: campForm.budgetType === 'LIFETIME' ? Number(campForm.budget) : undefined,
        start_time: campForm.startDate || undefined,
        stop_time: campForm.endDate || undefined,
        status: 'PAUSED',
      }),
    })
      .then(r => r.json())
      .then(data => {
        if (data.error) { notify('❌ ' + data.error); return }
        const updated = [...campagne, {
          ...campForm, id: data.id || Date.now().toString(),
          clienteName: client.name, status: 'PAUSED',
          createdAt: new Date().toISOString(), fromMeta: true,
        }]
        saveCampagne(updated); setCampagne(updated)
        notify('✅ Campagna creata su Meta!'); setTimeout(() => setPage('campagne'), 1500)
      })
      .catch(() => notify('❌ Errore durante la creazione'))
  }

  function saveSettingsForm() {
    saveSettings(settForm); setSettings(settForm); notify('Impostazioni salvate!')
  }

  function metaHeaders() {
    const token = settForm.token || settings.token
    return token ? { 'x-meta-token': token } : {}
  }

  function testConnection() {
    if (!settForm.token) { notify('Inserisci prima il token'); return }
    setConnStatus('Verifica in corso...')
    fetch(`${API}/api/me`, { headers: { 'x-meta-token': settForm.token } })
      .then(r => r.json())
      .then(d => { if (d.id) { setConnStatus('✅ Connesso: ' + (d.name || d.id)); notify('Connessione riuscita!') } else { setConnStatus('❌ ' + (d.error || 'Token non valido')) } })
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

  function exportData() {
    const blob = new Blob([JSON.stringify({ clients, campagne, exportedAt: new Date().toISOString() }, null, 2)], { type: 'application/json' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'adflow-backup.json'; a.click()
    notify('Backup esportato!')
  }

  const objOptions = [
    { val:'OUTCOME_TRAFFIC', label:'Traffico', icon:'🎯' },
    { val:'OUTCOME_LEADS', label:'Lead', icon:'🧲' },
    { val:'OUTCOME_SALES', label:'Vendite', icon:'💰' },
    { val:'OUTCOME_AWARENESS', label:'Awareness', icon:'📢' },
    { val:'OUTCOME_ENGAGEMENT', label:'Engagement', icon:'❤️' },
    { val:'OUTCOME_APP_PROMOTION', label:'App', icon:'📱' },
  ]
  const fmtOptions = [
    { val:'image', label:'Immagine', icon:'🖼️' },
    { val:'video', label:'Video', icon:'🎬' },
    { val:'carousel', label:'Carosello', icon:'🎠' },
    { val:'collection', label:'Collection', icon:'📦' },
  ]

  const navItems = [
    { id:'dashboard', label:'Dashboard', icon:'⊞' },
    { id:'clienti', label:'Clienti', icon:'👥' },
    { id:'campagne', label:'Campagne', icon:'→' },
    { id:'crea', label:'Nuova Campagna', icon:'+' },
    { id:'regole', label:'Regole Auto', icon:'≡' },
    { id:'report', label:'Report', icon:'📄' },
    { id:'impostazioni', label:'Impostazioni', icon:'⚙' },
  ]

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
            <button key={n.id} onClick={() => setPage(n.id)} style={{display:'flex',alignItems:'center',gap:10,padding:'9px 10px',borderRadius:8,cursor:'pointer',fontSize:13,color: page===n.id ? '#8b85ff' : '#9090b0',background: page===n.id ? 'rgba(108,99,255,.15)' : 'none',border:'none',width:'100%',textAlign:'left',marginBottom:2,fontFamily:'DM Sans,sans-serif'}}>
              <span style={{fontSize:14,opacity:.8}}>{n.icon}</span>{n.label}
            </button>
          ))}
        </nav>
        <div style={{padding:'12px 10px',borderTop:'1px solid #2a2a38'}}>
          <div style={{display:'flex',alignItems:'center',gap:10,padding:10,background:'#1a1a24',borderRadius:8,fontSize:13}}>
            <div style={{width:28,height:28,borderRadius:6,background:'#3d37cc',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:700,flexShrink:0}}>{(settings.agencyName||'A').charAt(0).toUpperCase()}</div>
            <div>
              <div style={{fontSize:12,fontWeight:500}}>{settings.agencyName||'La mia Agenzia'}</div>
              <div style={{fontSize:10,color: settings.token ? '#22c55e' : '#5a5a78'}}>{settings.token ? '● Token configurato' : '● Token mancante'}</div>
            </div>
          </div>
        </div>
      </aside>

      {/* MAIN */}
      <main style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>
        <div style={{padding:'16px 24px',borderBottom:'1px solid #2a2a38',background:'#111118',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          <div style={{fontFamily:'Syne,sans-serif',fontSize:18,fontWeight:700}}>{navItems.find(n=>n.id===page)?.label}</div>
          <div style={{display:'flex',gap:8}}>
            <button onClick={() => setPage('impostazioni')} style={{padding:'7px 14px',borderRadius:8,fontSize:12,cursor:'pointer',background:'#1a1a24',color:'#9090b0',border:'1px solid #2a2a38',fontFamily:'DM Sans,sans-serif'}}>⚙ Token</button>
            <button onClick={() => { setPage('crea'); setStep(1) }} style={{padding:'7px 14px',borderRadius:8,fontSize:12,cursor:'pointer',background:'#6c63ff',color:'white',border:'none',fontFamily:'DM Sans,sans-serif'}}>+ Nuova Campagna</button>
          </div>
        </div>

        <div style={{flex:1,overflowY:'auto',padding:24}}>

          {/* DASHBOARD */}
          {page==='dashboard' && (
            <div>
              {!settings.token && <div style={{padding:'12px 16px',background:'rgba(245,158,11,.1)',border:'1px solid rgba(245,158,11,.3)',borderRadius:8,color:'#fbbf24',fontSize:13,marginBottom:20}}>⚠ Token API non configurato. Vai in <strong>Impostazioni</strong> per iniziare.</div>}
              <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:24}}>
                {[{label:'Spesa Totale',val:'—'},{label:'ROAS Medio',val:'—'},{label:'Campagne Attive',val:campagne.filter(c=>c.status==='ACTIVE').length},{label:'Clienti',val:clients.length}].map((s,i) => (
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

          {/* CLIENTI */}
          {page==='clienti' && (
            <div>
              <div style={{display:'flex',justifyContent:'flex-end',marginBottom:16}}>
                <button onClick={() => setModalClient(true)} style={{padding:'8px 16px',borderRadius:8,background:'#6c63ff',color:'white',border:'none',fontSize:13,cursor:'pointer',fontFamily:'DM Sans,sans-serif'}}>+ Aggiungi Cliente</button>
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
                      <div style={{width:40,height:40,borderRadius:10,background:COLORS[i%COLORS.length]+'22',color:COLORS[i%COLORS.length],display:'flex',alignItems:'center',justifyContent:'center',fontSize:14,fontWeight:700,marginBottom:10}}>{c.name.substring(0,2).toUpperCase()}</div>
                      <div style={{fontSize:14,fontWeight:600}}>{c.name}</div>
                      <div style={{fontSize:11,color:'#5a5a78',marginTop:2}}>{c.sector} • {c.adAccount||'No Ad Account'}</div>
                      <div style={{display:'flex',gap:12,marginTop:12,paddingTop:12,borderTop:'1px solid #2a2a38'}}>
                        <div style={{fontSize:11,color:'#9090b0'}}><strong style={{display:'block',fontSize:13,color:'#f0f0f8'}}>—</strong>Spesa</div>
                        <div style={{fontSize:11,color:'#9090b0'}}><strong style={{display:'block',fontSize:13,color:'#f0f0f8'}}>—</strong>ROAS</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* CAMPAGNE */}
          {page==='campagne' && (
            <div style={{background:'#111118',border:'1px solid #2a2a38',borderRadius:12,overflow:'hidden'}}>
              <div style={{padding:'16px 20px',borderBottom:'1px solid #2a2a38',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                <div style={{fontSize:14,fontWeight:600}}>Tutte le Campagne <span style={{color:'#5a5a78',fontWeight:400,fontSize:12}}>({campagne.length})</span></div>
                <div style={{display:'flex',gap:8}}>
                  <button onClick={syncCampaigns} style={{padding:'6px 12px',borderRadius:8,background:'#1a1a24',color:'#9090b0',border:'1px solid #2a2a38',fontSize:12,cursor:'pointer',fontFamily:'DM Sans,sans-serif'}}>⟳ Sync Meta</button>
                  <button onClick={() => { setPage('crea'); setStep(1) }} style={{padding:'6px 12px',borderRadius:8,background:'#6c63ff',color:'white',border:'none',fontSize:12,cursor:'pointer',fontFamily:'DM Sans,sans-serif'}}>+ Nuova</button>
                </div>
              </div>
              {campagne.length === 0 ? (
                <div style={{textAlign:'center',padding:60,color:'#5a5a78'}}><div style={{fontSize:40,marginBottom:12}}>🚀</div><div style={{fontSize:13}}>Nessuna campagna ancora.</div></div>
              ) : (
                <table style={{width:'100%',borderCollapse:'collapse'}}>
                  <thead><tr>{['Campagna','Cliente','Obiettivo','Budget','Stato'].map(h => <th key={h} style={{fontSize:11,color:'#5a5a78',textTransform:'uppercase',letterSpacing:.5,padding:'10px 16px',textAlign:'left',borderBottom:'1px solid #2a2a38'}}>{h}</th>)}</tr></thead>
                  <tbody>{campagne.map(c => (
                    <tr key={c.id} style={{borderBottom:'1px solid #1a1a24'}}>
                      <td style={{padding:'12px 16px',fontSize:13,fontWeight:500}}>{c.nome}</td>
                      <td style={{padding:'12px 16px',fontSize:13,color:'#9090b0'}}>{c.clienteName}</td>
                      <td style={{padding:'12px 16px',fontSize:13,color:'#9090b0'}}>{c.obiettivo?.replace('OUTCOME_','')}</td>
                      <td style={{padding:'12px 16px',fontSize:13}}>€{c.budget}/g</td>
                      <td style={{padding:'12px 16px'}}><span style={{padding:'3px 8px',borderRadius:20,fontSize:11,background:'rgba(34,197,94,.15)',color:'#4ade80'}}>● {c.status}</span></td>
                    </tr>
                  ))}</tbody>
                </table>
              )}
            </div>
          )}

          {/* CREA CAMPAGNA */}
          {page==='crea' && (
            <div>
              <div style={{display:'flex',alignItems:'center',gap:0,marginBottom:28}}>
                {[1,2,3,4,5].map((s,i) => (
                  <div key={s} style={{display:'flex',alignItems:'center'}}>
                    <div style={{display:'flex',alignItems:'center',gap:8,fontSize:12,color: step===s ? '#8b85ff' : step>s ? '#22c55e' : '#5a5a78'}}>
                      <div style={{width:24,height:24,borderRadius:'50%',border:'1.5px solid currentColor',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:600}}>{step>s?'✓':s}</div>
                      {['Obiettivo','Pubblico','Creatività','Budget','Lancio'][i]}
                    </div>
                    {i<4 && <div style={{flex:1,height:1,background:'#2a2a38',margin:'0 8px',width:30}}></div>}
                  </div>
                ))}
              </div>

              <div style={{background:'#111118',border:'1px solid #2a2a38',borderRadius:12,padding:20,marginBottom:16}}>
                {step===1 && (
                  <div>
                    <div style={{fontSize:14,fontWeight:600,marginBottom:16}}>Obiettivo della Campagna</div>
                    <div style={{marginBottom:14}}>
                      <label style={{fontSize:12,color:'#9090b0',display:'block',marginBottom:6}}>Nome Campagna</label>
                      <input value={campForm.nome} onChange={e=>setCampForm({...campForm,nome:e.target.value})} placeholder="es. Offerta Estate 2025" style={{width:'100%',background:'#1a1a24',border:'1px solid #2a2a38',borderRadius:8,padding:'9px 12px',fontSize:13,color:'#f0f0f8',fontFamily:'DM Sans,sans-serif'}} />
                    </div>
                    <div style={{marginBottom:14}}>
                      <label style={{fontSize:12,color:'#9090b0',display:'block',marginBottom:6}}>Cliente</label>
                      <select value={campForm.clienteId} onChange={e=>setCampForm({...campForm,clienteId:e.target.value})} style={{width:'100%',background:'#1a1a24',border:'1px solid #2a2a38',borderRadius:8,padding:'9px 12px',fontSize:13,color:'#f0f0f8',fontFamily:'DM Sans,sans-serif'}}>
                        <option value="">— Seleziona cliente —</option>
                        {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </div>
                    <label style={{fontSize:12,color:'#9090b0',display:'block',marginBottom:8}}>Obiettivo</label>
                    <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:8}}>
                      {objOptions.map(o => (
                        <div key={o.val} onClick={() => setCampForm({...campForm,obiettivo:o.val})} style={{padding:12,background: campForm.obiettivo===o.val ? 'rgba(108,99,255,.15)' : '#1a1a24',border: campForm.obiettivo===o.val ? '1px solid #6c63ff' : '1px solid #2a2a38',borderRadius:8,cursor:'pointer',textAlign:'center'}}>
                          <div style={{fontSize:20,marginBottom:4}}>{o.icon}</div>
                          <div style={{fontSize:12,fontWeight:500}}>{o.label}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {step===2 && (
                  <div>
                    <div style={{fontSize:14,fontWeight:600,marginBottom:16}}>Definisci il Pubblico</div>
                    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
                      {[{label:'Età minima',key:'etaMin',type:'number'},{label:'Età massima',key:'etaMax',type:'number'},{label:'Paesi (es. IT,DE)',key:'paesi',type:'text'},{label:'Interessi',key:'interessi',type:'text'}].map(f => (
                        <div key={f.key}>
                          <label style={{fontSize:12,color:'#9090b0',display:'block',marginBottom:6}}>{f.label}</label>
                          <input type={f.type} value={campForm[f.key]} onChange={e=>setCampForm({...campForm,[f.key]:e.target.value})} style={{width:'100%',background:'#1a1a24',border:'1px solid #2a2a38',borderRadius:8,padding:'9px 12px',fontSize:13,color:'#f0f0f8',fontFamily:'DM Sans,sans-serif'}} />
                        </div>
                      ))}
                    </div>
                    <div style={{marginTop:12}}>
                      <label style={{fontSize:12,color:'#9090b0',display:'block',marginBottom:6}}>Posizionamenti</label>
                      <select value={campForm.placement} onChange={e=>setCampForm({...campForm,placement:e.target.value})} style={{width:'100%',background:'#1a1a24',border:'1px solid #2a2a38',borderRadius:8,padding:'9px 12px',fontSize:13,color:'#f0f0f8',fontFamily:'DM Sans,sans-serif'}}>
                        <option value="automatic">Automatico (consigliato)</option>
                        <option value="facebook_feed">Solo Feed Facebook</option>
                        <option value="instagram_feed">Solo Feed Instagram</option>
                        <option value="instagram_stories">Solo Stories Instagram</option>
                        <option value="reels">Solo Reels</option>
                      </select>
                    </div>
                  </div>
                )}
                {step===3 && (
                  <div>
                    <div style={{fontSize:14,fontWeight:600,marginBottom:16}}>Creatività dell'Annuncio</div>
                    <label style={{fontSize:12,color:'#9090b0',display:'block',marginBottom:8}}>Formato</label>
                    <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:8,marginBottom:14}}>
                      {fmtOptions.map(f => (
                        <div key={f.val} onClick={() => setCampForm({...campForm,formato:f.val})} style={{padding:10,background: campForm.formato===f.val ? 'rgba(108,99,255,.15)' : '#1a1a24',border: campForm.formato===f.val ? '1px solid #6c63ff' : '1px solid #2a2a38',borderRadius:8,cursor:'pointer',textAlign:'center'}}>
                          <div style={{fontSize:16,marginBottom:3}}>{f.icon}</div>
                          <div style={{fontSize:11}}>{f.label}</div>
                        </div>
                      ))}
                    </div>
                    {[{label:'Testo principale',key:'adText',tag:'textarea'},{label:'Titolo (Headline)',key:'adHeadline'},{label:'Descrizione',key:'adDesc'},{label:'URL di destinazione',key:'adUrl'}].map(f => (
                      <div key={f.key} style={{marginBottom:12}}>
                        <label style={{fontSize:12,color:'#9090b0',display:'block',marginBottom:6}}>{f.label}</label>
                        {f.tag==='textarea'
                          ? <textarea value={campForm[f.key]} onChange={e=>setCampForm({...campForm,[f.key]:e.target.value})} style={{width:'100%',background:'#1a1a24',border:'1px solid #2a2a38',borderRadius:8,padding:'9px 12px',fontSize:13,color:'#f0f0f8',fontFamily:'DM Sans,sans-serif',minHeight:70,resize:'vertical'}} />
                          : <input value={campForm[f.key]} onChange={e=>setCampForm({...campForm,[f.key]:e.target.value})} style={{width:'100%',background:'#1a1a24',border:'1px solid #2a2a38',borderRadius:8,padding:'9px 12px',fontSize:13,color:'#f0f0f8',fontFamily:'DM Sans,sans-serif'}} />
                        }
                      </div>
                    ))}
                    <label style={{fontSize:12,color:'#9090b0',display:'block',marginBottom:6}}>Call to Action</label>
                    <select value={campForm.adCta} onChange={e=>setCampForm({...campForm,adCta:e.target.value})} style={{width:'100%',background:'#1a1a24',border:'1px solid #2a2a38',borderRadius:8,padding:'9px 12px',fontSize:13,color:'#f0f0f8',fontFamily:'DM Sans,sans-serif'}}>
                      <option value="LEARN_MORE">Scopri di più</option>
                      <option value="SHOP_NOW">Acquista ora</option>
                      <option value="SIGN_UP">Iscriviti</option>
                      <option value="CONTACT_US">Contattaci</option>
                      <option value="GET_QUOTE">Richiedi preventivo</option>
                      <option value="BOOK_NOW">Prenota ora</option>
                    </select>
                  </div>
                )}
                {step===4 && (
                  <div>
                    <div style={{fontSize:14,fontWeight:600,marginBottom:16}}>Budget e Schedulazione</div>
                    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
                      {[{label:'Tipo budget',key:'budgetType',tag:'select',opts:[{v:'DAILY',l:'Giornaliero'},{v:'LIFETIME',l:'Totale'}]},{label:'Importo (€)',key:'budget',type:'number'},{label:'Data inizio',key:'startDate',type:'date'},{label:'Data fine (opzionale)',key:'endDate',type:'date'}].map(f => (
                        <div key={f.key}>
                          <label style={{fontSize:12,color:'#9090b0',display:'block',marginBottom:6}}>{f.label}</label>
                          {f.tag==='select'
                            ? <select value={campForm[f.key]} onChange={e=>setCampForm({...campForm,[f.key]:e.target.value})} style={{width:'100%',background:'#1a1a24',border:'1px solid #2a2a38',borderRadius:8,padding:'9px 12px',fontSize:13,color:'#f0f0f8',fontFamily:'DM Sans,sans-serif'}}>{f.opts.map(o=><option key={o.v} value={o.v}>{o.l}</option>)}</select>
                            : <input type={f.type||'text'} value={campForm[f.key]} onChange={e=>setCampForm({...campForm,[f.key]:e.target.value})} style={{width:'100%',background:'#1a1a24',border:'1px solid #2a2a38',borderRadius:8,padding:'9px 12px',fontSize:13,color:'#f0f0f8',fontFamily:'DM Sans,sans-serif'}} />
                          }
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {step===5 && (
                  <div>
                    <div style={{fontSize:14,fontWeight:600,marginBottom:16}}>Riepilogo e Lancio</div>
                    {!settings.token && <div style={{padding:'12px 16px',background:'rgba(245,158,11,.1)',border:'1px solid rgba(245,158,11,.3)',borderRadius:8,color:'#fbbf24',fontSize:13,marginBottom:16}}>⚠ Token non configurato. Vai in Impostazioni prima di lanciare.</div>}
                    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>
                      {[{l:'Campagna',v:campForm.nome||'—'},{l:'Cliente',v:clients.find(c=>c.id===campForm.clienteId)?.name||'—'},{l:'Obiettivo',v:campForm.obiettivo.replace('OUTCOME_','')},{l:'Formato',v:campForm.formato},{l:'Budget',v:'€'+campForm.budget+'/giorno'},{l:'Paesi',v:campForm.paesi},{l:'Età',v:campForm.etaMin+'-'+campForm.etaMax+' anni'},{l:'CTA',v:campForm.adCta}].map(r=>(
                        <div key={r.l}><div style={{fontSize:11,color:'#5a5a78',marginBottom:4}}>{r.l.toUpperCase()}</div><div style={{fontWeight:500,fontSize:13}}>{r.v}</div></div>
                      ))}
                    </div>
                    {campForm.adHeadline && <div style={{marginTop:16,paddingTop:16,borderTop:'1px solid #2a2a38'}}><div style={{fontSize:11,color:'#5a5a78',marginBottom:4}}>HEADLINE</div><div style={{fontWeight:500}}>{campForm.adHeadline}</div></div>}
                  </div>
                )}
              </div>
              <div style={{display:'flex',justifyContent: step===1 ? 'flex-end' : 'space-between'}}>
                {step>1 && <button onClick={()=>setStep(step-1)} style={{padding:'8px 18px',borderRadius:8,background:'#1a1a24',color:'#9090b0',border:'1px solid #2a2a38',fontSize:13,cursor:'pointer',fontFamily:'DM Sans,sans-serif'}}>← Indietro</button>}
                {step<5 && <button onClick={()=>setStep(step+1)} style={{padding:'8px 18px',borderRadius:8,background:'#6c63ff',color:'white',border:'none',fontSize:13,cursor:'pointer',fontFamily:'DM Sans,sans-serif'}}>Avanti →</button>}
                {step===5 && <button onClick={lanciaCampagna} style={{padding:'8px 20px',borderRadius:8,background:'#6c63ff',color:'white',border:'none',fontSize:13,cursor:'pointer',fontFamily:'DM Sans,sans-serif'}}>🚀 Lancia Campagna</button>}
              </div>
            </div>
          )}

          {/* REGOLE */}
          {page==='regole' && (
            <div>
              <div style={{padding:'12px 16px',background:'rgba(108,99,255,.1)',border:'1px solid rgba(108,99,255,.3)',borderRadius:8,color:'#8b85ff',fontSize:13,marginBottom:16}}>ℹ Le regole vengono verificate mentre la piattaforma è aperta. Con backend girano 24/7.</div>
              <div style={{display:'flex',justifyContent:'flex-end',marginBottom:16}}>
                <button onClick={()=>setModalRule(true)} style={{padding:'8px 16px',borderRadius:8,background:'#6c63ff',color:'white',border:'none',fontSize:13,cursor:'pointer',fontFamily:'DM Sans,sans-serif'}}>+ Aggiungi Regola</button>
              </div>
              {rules.map(r => (
                <div key={r.id} style={{display:'flex',alignItems:'center',gap:12,background:'#1a1a24',border:'1px solid #2a2a38',borderRadius:8,padding:'14px 16px',marginBottom:8}}>
                  <div style={{width:32,height:32,borderRadius:8,background:r.color,display:'flex',alignItems:'center',justifyContent:'center',fontSize:14,flexShrink:0}}>{r.icon}</div>
                  <div style={{flex:1}}>
                    <div style={{fontSize:13,fontWeight:500}}>{r.name}</div>
                    <div style={{fontSize:11,color:'#5a5a78',marginTop:2}}>{r.desc}</div>
                  </div>
                  <div onClick={()=>setRules(rules.map(x=>x.id===r.id?{...x,on:!x.on}:x))} style={{width:36,height:20,background: r.on ? '#6c63ff' : '#2a2a38',borderRadius:10,position:'relative',cursor:'pointer',transition:'background .2s'}}>
                    <div style={{position:'absolute',width:14,height:14,borderRadius:'50%',background:'white',top:3,left: r.on ? 19 : 3,transition:'left .2s'}}></div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* REPORT */}
          {page==='report' && (
            <div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:12,marginBottom:16}}>
                {[{t:'Report Settimanale',d:'Ultimi 7 giorni per tutti i clienti'},{t:'Report Mensile',d:'Analisi completa con trend'},{t:'Report per Cliente',d:'Dati di un singolo cliente'}].map(r=>(
                  <div key={r.t} style={{background:'#111118',border:'1px solid #2a2a38',borderRadius:12,padding:16}}>
                    <div style={{fontSize:14,fontWeight:600,marginBottom:6}}>{r.t}</div>
                    <div style={{fontSize:12,color:'#5a5a78',marginBottom:12}}>{r.d}</div>
                    <button onClick={()=>notify('Configura prima il token API')} style={{width:'100%',padding:'7px',borderRadius:8,background:'#1a1a24',color:'#9090b0',border:'1px solid #2a2a38',fontSize:12,cursor:'pointer',fontFamily:'DM Sans,sans-serif'}}>Genera</button>
                  </div>
                ))}
              </div>
              <div style={{background:'#111118',border:'1px solid #2a2a38',borderRadius:12,padding:20}}>
                <div style={{fontSize:14,fontWeight:600,marginBottom:12}}>Metriche disponibili</div>
                <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:8}}>
                  {['Spesa','ROAS','CPC','CTR','CPM','CPA','Impression','Reach','Click','Conversioni','Frequenza','Qualità'].map(m=>(
                    <div key={m} style={{fontSize:12,padding:8,background:'#1a1a24',borderRadius:8,textAlign:'center',color:'#9090b0'}}>{m}</div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* IMPOSTAZIONI */}
          {page==='impostazioni' && (
            <div>
              <div style={{background:'#111118',border:'1px solid #2a2a38',borderRadius:12,padding:20,marginBottom:16}}>
                <div style={{fontSize:14,fontWeight:600,marginBottom:4}}>Informazioni Agenzia</div>
                <div style={{fontSize:12,color:'#5a5a78',marginBottom:14}}>Salvate localmente nel tuo browser</div>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:14}}>
                  <div><label style={{fontSize:12,color:'#9090b0',display:'block',marginBottom:6}}>Nome Agenzia</label><input value={settForm.agencyName} onChange={e=>setSettForm({...settForm,agencyName:e.target.value})} placeholder="Digital Agency SRL" style={{width:'100%',background:'#1a1a24',border:'1px solid #2a2a38',borderRadius:8,padding:'9px 12px',fontSize:13,color:'#f0f0f8',fontFamily:'DM Sans,sans-serif'}} /></div>
                  <div><label style={{fontSize:12,color:'#9090b0',display:'block',marginBottom:6}}>Email</label><input value={settForm.email} onChange={e=>setSettForm({...settForm,email:e.target.value})} placeholder="info@agenzia.it" style={{width:'100%',background:'#1a1a24',border:'1px solid #2a2a38',borderRadius:8,padding:'9px 12px',fontSize:13,color:'#f0f0f8',fontFamily:'DM Sans,sans-serif'}} /></div>
                </div>
                <button onClick={saveSettingsForm} style={{padding:'7px 16px',borderRadius:8,background:'#6c63ff',color:'white',border:'none',fontSize:12,cursor:'pointer',fontFamily:'DM Sans,sans-serif'}}>Salva</button>
              </div>
              <div style={{background:'#111118',border:'1px solid #2a2a38',borderRadius:12,padding:20,marginBottom:16}}>
                <div style={{fontSize:14,fontWeight:600,marginBottom:4}}>Connessione Meta API</div>
                <div style={{fontSize:12,color:'#5a5a78',marginBottom:16}}>Ogni utente inserisce le proprie credenziali — i dati restano nel tuo browser</div>

                {/* GUIDA SETUP */}
                <div style={{background:'#0d0d14',border:'1px solid #2a2a48',borderRadius:10,padding:16,marginBottom:20}}>
                  <div style={{fontSize:12,fontWeight:600,color:'#8b85ff',marginBottom:14,letterSpacing:.3}}>Come configurare AdFlow — 3 passi</div>
                  <div style={{display:'flex',flexDirection:'column',gap:12}}>
                    <div style={{display:'flex',gap:12,alignItems:'flex-start'}}>
                      <div style={{width:24,height:24,borderRadius:'50%',background:'rgba(108,99,255,.25)',color:'#8b85ff',fontSize:11,fontWeight:700,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,marginTop:1}}>1</div>
                      <div>
                        <div style={{fontSize:12,fontWeight:600,color:'#e0e0f0',marginBottom:3}}>Crea l'app Meta</div>
                        <div style={{fontSize:11,color:'#5a5a78',lineHeight:1.6}}>Vai su <a href="https://developers.facebook.com/apps" target="_blank" rel="noreferrer" style={{color:'#8b85ff',textDecoration:'none'}}>developers.facebook.com/apps</a> → clicca <strong style={{color:'#9090b0'}}>Crea app</strong> → scegli tipo <strong style={{color:'#9090b0'}}>Business</strong> → una volta creata, copia l'<strong style={{color:'#9090b0'}}>App ID</strong> che appare in cima alla dashboard.</div>
                      </div>
                    </div>
                    <div style={{borderTop:'1px solid #1e1e2e'}}></div>
                    <div style={{display:'flex',gap:12,alignItems:'flex-start'}}>
                      <div style={{width:24,height:24,borderRadius:'50%',background:'rgba(108,99,255,.25)',color:'#8b85ff',fontSize:11,fontWeight:700,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,marginTop:1}}>2</div>
                      <div>
                        <div style={{fontSize:12,fontWeight:600,color:'#e0e0f0',marginBottom:3}}>Crea l'utente di sistema e genera il token</div>
                        <div style={{fontSize:11,color:'#5a5a78',lineHeight:1.6}}>Vai su <a href="https://business.facebook.com/settings" target="_blank" rel="noreferrer" style={{color:'#8b85ff',textDecoration:'none'}}>business.facebook.com/settings</a> → <strong style={{color:'#9090b0'}}>Utenti → Utenti di sistema</strong> → clicca <strong style={{color:'#9090b0'}}>Aggiungi</strong> e scegli ruolo <strong style={{color:'#9090b0'}}>Admin</strong>. Poi assegna gli ad account dei tuoi clienti, clicca <strong style={{color:'#9090b0'}}>Genera token</strong>, spunta i permessi <strong style={{color:'#9090b0'}}>ads_management</strong> e <strong style={{color:'#9090b0'}}>ads_read</strong>, e copia il token generato.</div>
                      </div>
                    </div>
                    <div style={{borderTop:'1px solid #1e1e2e'}}></div>
                    <div style={{display:'flex',gap:12,alignItems:'flex-start'}}>
                      <div style={{width:24,height:24,borderRadius:'50%',background:'rgba(108,99,255,.25)',color:'#8b85ff',fontSize:11,fontWeight:700,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,marginTop:1}}>3</div>
                      <div>
                        <div style={{fontSize:12,fontWeight:600,color:'#e0e0f0',marginBottom:3}}>Trova il Business Manager ID</div>
                        <div style={{fontSize:11,color:'#5a5a78',lineHeight:1.6}}>Sempre su <a href="https://business.facebook.com/settings" target="_blank" rel="noreferrer" style={{color:'#8b85ff',textDecoration:'none'}}>business.facebook.com/settings</a> → <strong style={{color:'#9090b0'}}>Informazioni business</strong>. Il numero ID è in cima alla pagina, sotto il nome della tua azienda.</div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* CAMPI */}
                <div style={{marginBottom:14}}>
                  <label style={{fontSize:12,color:'#9090b0',display:'block',marginBottom:6}}>App ID Meta</label>
                  <input type="text" value={settForm.appId} onChange={e=>setSettForm({...settForm,appId:e.target.value})} placeholder="Es. 1234567890123456" style={{width:'100%',background:'#1a1a24',border:'1px solid #2a2a38',borderRadius:8,padding:'9px 12px',fontSize:13,color:'#f0f0f8',fontFamily:'monospace'}} />
                  <div style={{fontSize:11,color:'#5a5a78',marginTop:5,lineHeight:1.5}}>L'ID della tua app Meta (vedi step 1). Lo trovi nella dashboard di <a href="https://developers.facebook.com/apps" target="_blank" rel="noreferrer" style={{color:'#6c63ff',textDecoration:'none'}}>developers.facebook.com</a> non appena selezioni la tua app.</div>
                </div>
                <div style={{marginBottom:14}}>
                  <label style={{fontSize:12,color:'#9090b0',display:'block',marginBottom:6}}>System User Token</label>
                  <input type={!tokenVisible ? 'password' : 'text'} value={settForm.token} onChange={e=>setSettForm({...settForm,token:e.target.value})} placeholder="Token generato nello step 2…" style={{width:'100%',background:'#1a1a24',border:'1px solid #2a2a38',borderRadius:8,padding:'9px 12px',fontSize:13,color:'#f0f0f8',fontFamily:'monospace'}} />
                  <div style={{fontSize:11,color:'#5a5a78',marginTop:5,lineHeight:1.5}}>Il token che autorizza AdFlow a gestire le campagne. Generato nello step 2 — assicurati di copiarlo subito, non viene mostrato di nuovo.</div>
                </div>
                <div style={{marginBottom:16}}>
                  <label style={{fontSize:12,color:'#9090b0',display:'block',marginBottom:6}}>Business Manager ID</label>
                  <input type="text" value={settForm.bmId} onChange={e=>setSettForm({...settForm,bmId:e.target.value})} placeholder="Es. 123456789012345" style={{width:'100%',background:'#1a1a24',border:'1px solid #2a2a38',borderRadius:8,padding:'9px 12px',fontSize:13,color:'#f0f0f8',fontFamily:'monospace'}} />
                  <div style={{fontSize:11,color:'#5a5a78',marginTop:5,lineHeight:1.5}}>Il numero ID del tuo Business Manager (vedi step 3). È un numero lungo tipo <em>123456789012345</em> — niente prefissi, solo cifre.</div>
                </div>

                <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
                  <button onClick={saveSettingsForm} style={{padding:'7px 16px',borderRadius:8,background:'#6c63ff',color:'white',border:'none',fontSize:12,cursor:'pointer',fontFamily:'DM Sans,sans-serif'}}>Salva Credenziali</button>
                  <button onClick={()=>setTokenVisible(!tokenVisible)} style={{padding:'7px 16px',borderRadius:8,background:'#1a1a24',color:'#9090b0',border:'1px solid #2a2a38',fontSize:12,cursor:'pointer',fontFamily:'DM Sans,sans-serif'}}>{tokenVisible?'Nascondi Token':'Mostra Token'}</button>
                  <button onClick={testConnection} style={{padding:'7px 16px',borderRadius:8,background:'#1a1a24',color:'#9090b0',border:'1px solid #2a2a38',fontSize:12,cursor:'pointer',fontFamily:'DM Sans,sans-serif'}}>Testa Connessione</button>
                  {connStatus && <span style={{fontSize:12,color: connStatus.includes('✅') ? '#22c55e' : connStatus.includes('❌') ? '#ef4444' : '#9090b0'}}>{connStatus}</span>}
                </div>
              </div>
            </div>
          )}

        </div>
      </main>

      {/* MODAL CLIENTE */}
      {modalClient && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.7)',zIndex:100,display:'flex',alignItems:'center',justifyContent:'center'}}>
          <div style={{background:'#111118',border:'1px solid #3a3a4e',borderRadius:16,padding:24,width:520,maxWidth:'95vw',maxHeight:'85vh',overflowY:'auto'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20}}>
              <div style={{fontFamily:'Syne,sans-serif',fontSize:16,fontWeight:700}}>Aggiungi Cliente</div>
              <button onClick={()=>setModalClient(false)} style={{background:'none',border:'none',color:'#5a5a78',cursor:'pointer',fontSize:18}}>✕</button>
            </div>
            <div style={{marginBottom:14}}>
              <label style={{fontSize:12,color:'#9090b0',display:'block',marginBottom:6}}>Nome Cliente / Azienda</label>
              <input value={clientForm.name} onChange={e=>setClientForm({...clientForm,name:e.target.value})} placeholder="Es. Rossini Srl" style={{width:'100%',background:'#1a1a24',border:'1px solid #2a2a38',borderRadius:8,padding:'9px 12px',fontSize:13,color:'#f0f0f8',fontFamily:'DM Sans,sans-serif'}} />
            </div>
            <div style={{marginBottom:14}}>
              <label style={{fontSize:12,color:'#9090b0',display:'block',marginBottom:6}}>Ad Account ID</label>
              <input value={clientForm.adAccount} onChange={e=>setClientForm({...clientForm,adAccount:e.target.value})} placeholder="act_123456789" style={{width:'100%',background:'#1a1a24',border:'1px solid #2a2a38',borderRadius:8,padding:'9px 12px',fontSize:13,color:'#f0f0f8',fontFamily:'monospace'}} />
              <div style={{fontSize:11,color:'#5a5a78',marginTop:5,lineHeight:1.5}}>Il formato è sempre <strong style={{color:'#9090b0'}}>act_</strong> seguito da un numero (es. <em>act_123456789</em>). Lo trovi in <strong style={{color:'#9090b0'}}>Business Manager → Account pubblicitari</strong>, oppure nell'URL di Gestione inserzioni quando sei dentro all'account del cliente.</div>
            </div>
            <div style={{marginBottom:14}}>
              <label style={{fontSize:12,color:'#9090b0',display:'block',marginBottom:6}}>Pagina Facebook ID</label>
              <input value={clientForm.pageId} onChange={e=>setClientForm({...clientForm,pageId:e.target.value})} placeholder="123456789" style={{width:'100%',background:'#1a1a24',border:'1px solid #2a2a38',borderRadius:8,padding:'9px 12px',fontSize:13,color:'#f0f0f8',fontFamily:'DM Sans,sans-serif'}} />
            </div>
            <div style={{marginBottom:14}}>
              <label style={{fontSize:12,color:'#9090b0',display:'block',marginBottom:6}}>Settore</label>
              <select value={clientForm.sector} onChange={e=>setClientForm({...clientForm,sector:e.target.value})} style={{width:'100%',background:'#1a1a24',border:'1px solid #2a2a38',borderRadius:8,padding:'9px 12px',fontSize:13,color:'#f0f0f8',fontFamily:'DM Sans,sans-serif'}}>
                {['E-commerce','Ristorazione','Immobiliare','Salute & Benessere','Moda & Lifestyle','B2B / Servizi','Turismo','Altro'].map(s=><option key={s}>{s}</option>)}
              </select>
            </div>
            <div style={{marginBottom:20}}>
              <label style={{fontSize:12,color:'#9090b0',display:'block',marginBottom:6}}>Note</label>
              <textarea value={clientForm.notes} onChange={e=>setClientForm({...clientForm,notes:e.target.value})} style={{width:'100%',background:'#1a1a24',border:'1px solid #2a2a38',borderRadius:8,padding:'9px 12px',fontSize:13,color:'#f0f0f8',fontFamily:'DM Sans,sans-serif',minHeight:70,resize:'vertical'}} />
            </div>
            <div style={{display:'flex',justifyContent:'flex-end',gap:8}}>
              <button onClick={()=>setModalClient(false)} style={{padding:'8px 16px',borderRadius:8,background:'#1a1a24',color:'#9090b0',border:'1px solid #2a2a38',fontSize:13,cursor:'pointer',fontFamily:'DM Sans,sans-serif'}}>Annulla</button>
              <button onClick={saveClient} style={{padding:'8px 16px',borderRadius:8,background:'#6c63ff',color:'white',border:'none',fontSize:13,cursor:'pointer',fontFamily:'DM Sans,sans-serif'}}>Aggiungi</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL REGOLA */}
      {modalRule && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.7)',zIndex:100,display:'flex',alignItems:'center',justifyContent:'center'}}>
          <div style={{background:'#111118',border:'1px solid #3a3a4e',borderRadius:16,padding:24,width:480,maxWidth:'95vw'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20}}>
              <div style={{fontFamily:'Syne,sans-serif',fontSize:16,fontWeight:700}}>Nuova Regola Automatica</div>
              <button onClick={()=>setModalRule(false)} style={{background:'none',border:'none',color:'#5a5a78',cursor:'pointer',fontSize:18}}>✕</button>
            </div>
            {[{label:'Nome regola',key:'name',tag:'input',placeholder:'Es. Pausa se CPA alto'},{label:'Condizione',key:'condition',tag:'select',opts:[{v:'cpa_gt',l:'CPA maggiore di'},{v:'roas_gt',l:'ROAS maggiore di'},{v:'ctr_lt',l:'CTR minore di'},{v:'spend_gt',l:'Spesa maggiore di'}]},{label:'Valore soglia',key:'value',tag:'input',type:'number',placeholder:'Es. 10'},{label:'Azione',key:'action',tag:'select',opts:[{v:'pause',l:'Metti in pausa'},{v:'budget_increase',l:'Aumenta budget 20%'},{v:'budget_decrease',l:'Riduci budget 20%'},{v:'notify',l:'Solo notifica'}]}].map(f=>(
              <div key={f.key} style={{marginBottom:14}}>
                <label style={{fontSize:12,color:'#9090b0',display:'block',marginBottom:6}}>{f.label}</label>
                {f.tag==='select'
                  ? <select value={ruleForm[f.key]} onChange={e=>setRuleForm({...ruleForm,[f.key]:e.target.value})} style={{width:'100%',background:'#1a1a24',border:'1px solid #2a2a38',borderRadius:8,padding:'9px 12px',fontSize:13,color:'#f0f0f8',fontFamily:'DM Sans,sans-serif'}}>{f.opts.map(o=><option key={o.v} value={o.v}>{o.l}</option>)}</select>
                  : <input type={f.type||'text'} value={ruleForm[f.key]} onChange={e=>setRuleForm({...ruleForm,[f.key]:e.target.value})} placeholder={f.placeholder} style={{width:'100%',background:'#1a1a24',border:'1px solid #2a2a38',borderRadius:8,padding:'9px 12px',fontSize:13,color:'#f0f0f8',fontFamily:'DM Sans,sans-serif'}} />
                }
              </div>
            ))}
            <div style={{display:'flex',justifyContent:'flex-end',gap:8,marginTop:8}}>
              <button onClick={()=>setModalRule(false)} style={{padding:'8px 16px',borderRadius:8,background:'#1a1a24',color:'#9090b0',border:'1px solid #2a2a38',fontSize:13,cursor:'pointer',fontFamily:'DM Sans,sans-serif'}}>Annulla</button>
              <button onClick={saveRule} style={{padding:'8px 16px',borderRadius:8,background:'#6c63ff',color:'white',border:'none',fontSize:13,cursor:'pointer',fontFamily:'DM Sans,sans-serif'}}>Aggiungi</button>
            </div>
          </div>
        </div>
      )}

      {/* NOTIFICA */}
      {showNotif && (
        <div style={{position:'fixed',bottom:24,right:24,background:'#1a1a24',border:'1px solid #3a3a4e',borderLeft:'3px solid #6c63ff',borderRadius:12,padding:'14px 18px',fontSize:13,zIndex:200,maxWidth:300}}>
          {notif}
        </div>
      )}
    </div>
  )
}
