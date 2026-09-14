import { useState, useEffect, useRef, useCallback } from 'react'
import './App.css'

/* ─── Types ─────────────────────────────────────────────────────────────── */
type ScriptRow  = { time: string; visual: string; voice: string; sfx: string; source: string | string[] }
type Validation = { coverage_percent: number; groundedness_percent: number; readability_grade: number; estimated_seconds: number; duration_target: string; source_pages?: number[]; extracted_pages?: number; selected_pages?: number[]; pages_without_text?: number[]; duration_within_tolerance?: boolean; duration_delta_seconds?: number }
type TabId      = 'script' | 'checks' | 'trace'
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

/* =========================================================
   CURSOR FOLLOWER
   Key fix: uses transform-only positioning (no left/top changes).
   Dot  → snaps exactly to mouse via transform.
   Ring → lerps toward mouse each RAF frame.
   Both start opacity:0 and fade in on first move.
   ========================================================= */
function CursorFollower() {
  const dotRef  = useRef<HTMLDivElement>(null)
  const ringRef = useRef<HTMLDivElement>(null)
  const spotRef = useRef<HTMLDivElement>(null)

  // Track mouse in a ref (no re-renders needed)
  const mouse  = useRef({ x: -999, y: -999 })
  const ring   = useRef({ x: -999, y: -999 })
  const shown  = useRef(false)
  const rafId  = useRef<number>(0)

  useEffect(() => {
    const loop = () => {
      const LERP = 0.11
      ring.current.x += (mouse.current.x - ring.current.x) * LERP
      ring.current.y += (mouse.current.y - ring.current.y) * LERP
      if (ringRef.current) ringRef.current.style.transform = `translate(${ring.current.x - 18}px, ${ring.current.y - 18}px)`
      if (spotRef.current) spotRef.current.style.transform = `translate(${mouse.current.x - 250}px, ${mouse.current.y - 250}px)`
      rafId.current = requestAnimationFrame(loop)
    }
    const onMove = (e: MouseEvent) => {
      mouse.current.x = e.clientX
      mouse.current.y = e.clientY

      // Dot: offset by half its own size (8/2 = 4)
      if (dotRef.current) {
        dotRef.current.style.transform = `translate(${e.clientX - 4}px, ${e.clientY - 4}px)`

        // Reveal on first move
        if (!shown.current) {
          shown.current = true
          dotRef.current.style.opacity  = '1'
          if (ringRef.current) ringRef.current.style.opacity = '0.75'
        }
      }
    }

    const onOver = (e: MouseEvent) => {
      const el = (e.target as HTMLElement)
      if (el.tagName === 'BUTTON' || el.closest('button') ||
          el.tagName === 'A'      || el.closest('a')      ||
          el.classList.contains('upload-zone') || el.closest('.upload-zone')) {
        document.body.dataset.cursor = 'hover'
      } else if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') {
        document.body.dataset.cursor = 'text'
      } else {
        document.body.dataset.cursor = ''
      }
    }

    const onDown = () => { document.body.dataset.cursor = 'click' }
    const onUp   = (e: MouseEvent) => { onOver(e) }  // re-detect after click

    document.addEventListener('mousemove',  onMove,  { passive: true })
    document.addEventListener('mouseover',  onOver,  { passive: true })
    document.addEventListener('mousedown',  onDown)
    document.addEventListener('mouseup',    onUp)

    rafId.current = requestAnimationFrame(loop)

    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseover', onOver)
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('mouseup',   onUp)
      cancelAnimationFrame(rafId.current)
    }
  }, [])

  return (
    <>
      <div className="cursor-spotlight" ref={spotRef} />
      <div className="cursor-dot"       ref={dotRef}  />
      <div className="cursor-ring"      ref={ringRef} />
    </>
  )
}

/* =========================================================
   MAGNETIC BUTTON HOOK
   ========================================================= */
function useMagnet(strength = 0.38) {
  const ref = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onMove = (e: MouseEvent) => {
      const r  = el.getBoundingClientRect()
      const dx = (e.clientX - (r.left + r.width  / 2)) * strength
      const dy = (e.clientY - (r.top  + r.height / 2)) * strength
      el.style.transform = `translate(${dx}px, ${dy}px)`
    }
    const onLeave = () => { el.style.transform = '' }
    el.addEventListener('mousemove',  onMove)
    el.addEventListener('mouseleave', onLeave)
    return () => {
      el.removeEventListener('mousemove',  onMove)
      el.removeEventListener('mouseleave', onLeave)
    }
  }, [strength])
  return ref
}

/* =========================================================
   SVG COMPONENTS — green theme
   ========================================================= */

function FilmReelSVG() {
  return (
    <svg width="96" height="96" viewBox="0 0 100 100" fill="none"
         style={{ animation: 'spin-slow 14s linear infinite',
                  filter: 'drop-shadow(0 0 10px rgba(57,231,95,0.5))' }}>
      <circle cx="50" cy="50" r="46" stroke="url(#rG)" strokeWidth="1.5" strokeDasharray="5 3" />
      <circle cx="50" cy="50" r="14" fill="url(#rInner)" />
      <circle cx="50" cy="50" r="5.5" fill="#090c09" />
      {[0,60,120,180,240,300].map((deg, i) => {
        const r = (deg * Math.PI) / 180
        const x = 50 + 30 * Math.cos(r), y = 50 + 30 * Math.sin(r)
        return <circle key={i} cx={x} cy={y} r="7" fill="#111811" stroke="rgba(57,231,95,0.35)" strokeWidth="1" />
      })}
      {[0,60,120,180,240,300].map((deg, i) => {
        const r = (deg * Math.PI) / 180
        const x1 = 50 + 16 * Math.cos(r), y1 = 50 + 16 * Math.sin(r)
        const x2 = 50 + 22 * Math.cos(r), y2 = 50 + 22 * Math.sin(r)
        return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgba(255,107,43,0.65)" strokeWidth="1.5" />
      })}
      <defs>
        <linearGradient id="rG" x1="0" y1="0" x2="100" y2="100" gradientUnits="userSpaceOnUse">
          <stop stopColor="#39e75f"/><stop offset="0.5" stopColor="#ff6b2b"/><stop offset="1" stopColor="#00d4aa"/>
        </linearGradient>
        <radialGradient id="rInner" cx="50%" cy="50%" r="50%">
          <stop stopColor="#39e75f"/><stop offset="1" stopColor="#111811"/>
        </radialGradient>
      </defs>
    </svg>
  )
}

function ClapperSVG({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <rect x="2" y="8" width="20" height="13" rx="2" fill="rgba(57,231,95,0.15)" stroke="rgba(57,231,95,0.7)" strokeWidth="1.5"/>
      <path d="M2 11h20M7 8l2-6M12 8l2-6M17 8l2-6" stroke="rgba(255,107,43,0.8)" strokeWidth="1.5" strokeLinecap="round"/>
      <circle cx="12" cy="15" r="2.5" fill="rgba(57,231,95,0.3)" stroke="rgba(57,231,95,0.9)" strokeWidth="1"/>
    </svg>
  )
}

function UploadSVG() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <path d="M12 15V3m0 0l-4 4m4-4l4 4" stroke="#39e75f" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" stroke="rgba(57,231,95,0.5)" strokeWidth="1.8" strokeLinecap="round"/>
    </svg>
  )
}

function WaveformSVG() {
  const bars = [3,7,5,9,4,8,6,10,5,7,3,8,6,4,9,5,7,3,6,8]
  return (
    <svg width="60" height="14" viewBox="0 0 60 14" fill="none"
         style={{ opacity: 0.35, marginBottom: 4 }}>
      {bars.map((h, i) => (
        <rect key={i} x={i*3} y={(14-h)/2} width="2" height={h} rx="1"
              fill="url(#wvG)"
              style={{ animation: `waveform ${0.55+i*0.07}s ease-in-out infinite alternate`,
                       transformOrigin: 'center', animationDelay: `${i*0.04}s` }} />
      ))}
      <defs>
        <linearGradient id="wvG" x1="0" y1="0" x2="0" y2="1">
          <stop stopColor="#39e75f"/><stop offset="1" stopColor="#00d4aa"/>
        </linearGradient>
      </defs>
    </svg>
  )
}

function EmptySVG() {
  return (
    <svg width="62" height="62" viewBox="0 0 64 64" fill="none">
      <rect x="8" y="18" width="48" height="30" rx="3"
            fill="rgba(57,231,95,0.07)" stroke="rgba(57,231,95,0.3)" strokeWidth="1.5"/>
      <rect x="8" y="18" width="48" height="7"
            fill="rgba(57,231,95,0.12)" stroke="rgba(57,231,95,0.3)" strokeWidth="1.5"/>
      {[14,22,30,38,46].map(x => (
        <circle key={x} cx={x} cy="21.5" r="2" fill="rgba(0,0,0,0.5)"
                stroke="rgba(57,231,95,0.4)" strokeWidth="1"/>
      ))}
      <path d="M26 31l14 8-14 8V31z" fill="rgba(57,231,95,0.5)"
            stroke="rgba(57,231,95,0.8)" strokeWidth="1.5" strokeLinejoin="round"/>
      <circle cx="54" cy="10" r="2" fill="#39e75f" opacity="0.7"
              style={{ animation: 'blink 2s ease infinite' }}/>
      <circle cx="10" cy="10" r="1.5" fill="#ff6b2b" opacity="0.7"
              style={{ animation: 'blink 2.4s ease 0.5s infinite' }}/>
      <circle cx="58" cy="52" r="1" fill="#00d4aa" opacity="0.7"
              style={{ animation: 'blink 1.8s ease 1s infinite' }}/>
    </svg>
  )
}

function SpotlightSVG() {
  return (
    <svg width="200" height="64" viewBox="0 0 200 64" fill="none"
         style={{ position:'absolute', right:0, top:0, opacity:0.12, pointerEvents:'none' }}>
      <path d="M180 0 L158 64 L200 64 Z" fill="url(#sG1)" />
      <path d="M140 0 L110 64 L165 64 Z" fill="url(#sG2)" />
      <defs>
        <linearGradient id="sG1" x1="0" y1="0" x2="0" y2="1">
          <stop stopColor="#39e75f"/><stop offset="1" stopColor="transparent" stopOpacity="0"/>
        </linearGradient>
        <linearGradient id="sG2" x1="0" y1="0" x2="0" y2="1">
          <stop stopColor="#ff6b2b"/><stop offset="1" stopColor="transparent" stopOpacity="0"/>
        </linearGradient>
      </defs>
    </svg>
  )
}

function Particles() {
  const [pts] = useState(() => Array.from({ length: 16 }, (_, i) => ({
    id: i,
    size: Math.random() * 2.5 + 1,
    x: Math.random() * 100, y: Math.random() * 100,
    dur: 5 + Math.random() * 7,
    del: Math.random() * 5,
    dx: (Math.random() - 0.5) * 36,
    dy: (Math.random() - 0.5) * 36,
  })))
  return (
    <div style={{ position:'absolute', inset:0, overflow:'hidden', pointerEvents:'none' }}>
      {pts.map(p => (
        <div key={p.id} style={{
          position: 'absolute', left:`${p.x}%`, top:`${p.y}%`,
          width: p.size, height: p.size, borderRadius: '50%',
          background: p.id%3===0 ? '#39e75f' : p.id%3===1 ? '#ff6b2b' : '#00d4aa',
          '--dx':`${p.dx}px`, '--dy':`${p.dy}px`,
          animation: `particle-drift ${p.dur}s ease-in-out ${p.del}s infinite`,
        } as React.CSSProperties} />
      ))}
    </div>
  )
}

/* =========================================================
   ANIMATED NUMBER
   ========================================================= */
function AnimatedNumber({ value, suffix = '' }: { value: number; suffix?: string }) {
  const [display, setDisplay] = useState(0)
  const raf = useRef<number>(0)
  useEffect(() => {
    const start = performance.now()
    const tick  = (now: number) => {
      const p = Math.min((now - start) / 1000, 1)
      setDisplay(Math.round((1 - Math.pow(1 - p, 3)) * value))
      if (p < 1) raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current)
  }, [value])
  return <>{display}{suffix}</>
}

/* =========================================================
   TAB NAV — Sliding pill (spring easing)
   ========================================================= */
const TAB_LABELS: Record<TabId, string> = {
  script: 'Final script',
  checks: 'Validation report',
  trace:  'Pipeline trace',
}

function TabNav({ activeTab, setActiveTab, rowCount }: {
  activeTab: TabId; setActiveTab: (t: TabId) => void; rowCount: number
}) {
  const navRef  = useRef<HTMLElement>(null)
  const btnRefs = useRef<Record<TabId, HTMLButtonElement | null>>({ script: null, checks: null, trace: null })
  const [pill, setPill] = useState({ left: 4, width: 0 })

  const measure = useCallback(() => {
    const nav = navRef.current, btn = btnRefs.current[activeTab]
    if (!nav || !btn) return
    const nr = nav.getBoundingClientRect(), br = btn.getBoundingClientRect()
    setPill({ left: br.left - nr.left, width: br.width })
  }, [activeTab])

  useEffect(() => { measure() }, [measure])
  useEffect(() => {
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [measure])

  return (
    <nav className="tabs" ref={navRef}>
      <div className="tabs__pill" style={{ left: pill.left, width: pill.width || 'auto' }} />
      {(['script','checks','trace'] as TabId[]).map(tab => (
        <button
          key={tab}
          ref={el => { btnRefs.current[tab] = el }}
          className={activeTab === tab ? 'active' : ''}
          onClick={() => setActiveTab(tab)}
        >
          {TAB_LABELS[tab]}
          {tab === 'script' && rowCount > 0 && (
            <span style={{
              fontSize: 10, fontWeight: 800,
              background: activeTab === 'script' ? 'rgba(5,10,5,0.25)' : 'rgba(57,231,95,0.12)',
              color: activeTab === 'script' ? 'rgba(5,10,5,0.9)' : '#39e75f',
              borderRadius: 10, padding: '2px 7px',
              border: `1px solid ${activeTab === 'script' ? 'rgba(5,10,5,0.2)' : 'rgba(57,231,95,0.25)'}`,
              transition: 'all 0.22s',
            }}>{rowCount}</span>
          )}
        </button>
      ))}
    </nav>
  )
}

/* =========================================================
   MAIN APP
   ========================================================= */
function App() {
  const [fileName, setFileName]               = useState('No PDF selected')
  const [selectedFile, setSelectedFile]       = useState<File | null>(null)
  const [rows, setRows]                       = useState<ScriptRow[]>([])
  const [isGenerating, setIsGenerating]       = useState(false)
  const [generationError, setGenerationError] = useState('')
  const [activeTab, setActiveTab]             = useState<TabId>('script')
  const [animationStyle, setAnimationStyle]   = useState<'2D' | '3D' | ''>('')
  const [grade, setGrade]                     = useState('')
  const [duration, setDuration]               = useState('')
  const [pageSelection, setPageSelection]     = useState('')
  const [instructions, setInstructions]       = useState('')
  const [validation, setValidation]           = useState<Validation | null>(null)
  const [pipelineStage, setPipelineStage]     = useState(0)
  const [regeneratingRow, setRegeneratingRow] = useState<number | null>(null)

  const magnetBtn = useMagnet(0.35)

  const generate = async () => {
    setGenerationError(''); setIsGenerating(true)
    if (!selectedFile)                           { setGenerationError('Choose a lesson PDF before generating.'); setIsGenerating(false); return }
    if (!grade || !duration || !animationStyle)  { setGenerationError('Choose a grade, enter a duration, and select an animation style.'); setIsGenerating(false); return }
    const form = new FormData()
    form.append('file', selectedFile); form.append('grade', grade)
    form.append('duration', duration); form.append('style', animationStyle)
      form.append('pages', pageSelection)
    form.append('instructions', instructions || 'Use clear, age-appropriate language with a strong hook and natural transitions.')
    try {
      setPipelineStage(1)
      const res = await fetch('/api/generate', { method: 'POST', body: form })
      if (!res.ok) throw new Error(`Backend returned ${res.status}`)
      setPipelineStage(5)
      const result = await res.json()
      setRows(result.script); setValidation(result.validation); setPipelineStage(6)
    } catch (err) {
      setGenerationError(err instanceof Error ? err.message : 'Could not reach the backend.')
    } finally { setIsGenerating(false) }
  }

  const exportCsv = () => {
      const csvEscape = (value: string | number) => {
        const normalized = String(value).replace(/\r?\n|\r/g, ' ').replace(/\s+/g, ' ').trim()
        return `"${normalized.replace(/"/g, '""')}"`
      }
      const header = ['Time', 'Visual / Animation', 'Voice-over / Dialogue', 'OTS / SFX', 'Source Pages']
      const lines = rows.map(row => [
        row.time,
        row.visual,
        row.voice,
        row.sfx,
        Array.isArray(row.source) ? row.source.join('; ') : row.source,
      ].map(csvEscape).join(','))
      // BOM makes UTF-8 punctuation and non-English lesson text open correctly in Excel.
      const csv = `\uFEFF${[header.map(csvEscape).join(','), ...lines].join('\r\n')}\r\n`
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
      const baseName = fileName.replace(/\.pdf$/i, '').replace(/[^a-z0-9-_]+/gi, '-').replace(/^-+|-+$/g, '') || 'lesson-script'
      a.download = `${baseName}-script.csv`
      a.click()
      window.setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }

  const regenerateRow = async (index: number) => {
    const row = rows[index]; setRegeneratingRow(index)
    try {
      const srcTag = Array.isArray(row.source) ? row.source.join(', ') : row.source
      const res = await fetch('/api/regenerate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ time: row.time, source: `${row.voice} (${srcTag})`, grade: Number(grade), style: animationStyle, instructions })
      })
      if (!res.ok) throw new Error(`Backend returned ${res.status}`)
      const rep = await res.json()
      setRows(cur => cur.map((r, i) => i === index ? rep : r))
    } catch (err) {
      setGenerationError(err instanceof Error ? err.message : 'Could not regenerate.')
    } finally { setRegeneratingRow(null) }
  }

  const stages = ['Extract','Classify','Concepts','Plan','Generate','Validate']

  const metricCards = [
    { label:'Coverage',     value: validation ? `${validation.coverage_percent}%` : '—',       rawValue: validation?.coverage_percent ?? 0,                                       sub: validation ? 'concept checklist' : 'Awaiting PDF',          color:'#39e75f' },
    { label:'Groundedness', value: validation ? `${validation.groundedness_percent}%` : '—',   rawValue: validation?.groundedness_percent ?? 0,                                   sub: validation ? 'source traceability' : 'Awaiting generation',  color:'#00d4aa' },
    { label:'Readability',  value: validation ? `Grade ${validation.readability_grade}` : '—', rawValue: validation ? Math.min(100,(validation.readability_grade/12)*100) : 0,    sub: validation ? `target grade ${grade}` : 'No result yet',      color:'#ff6b2b' },
    { label:'Duration',     value: validation ? fmt(validation.estimated_seconds) : '—',       rawValue: validation ? Math.min(100,(validation.estimated_seconds/300)*100) : 0,   sub: validation ? `target ${validation.duration_target}` : 'No result yet', color:'#ffe566' },
  ]

  return (
    <>
      <CursorFollower />

      <main className="app-shell">
        {/* ── Topbar ── */}
        <header className="topbar" style={{ position:'relative', overflow:'hidden' }}>
          <Particles />
          <SpotlightSVG />
          <div className="brand-mark" style={{ position:'relative', zIndex:1 }}>
            <ClapperSVG size={18} />
          </div>
          <div className="topbar-info" style={{ position:'relative', zIndex:1 }}>
            <strong>Script Studio</strong>
            <span>AI Video Script Generator</span>
          </div>
          <div className="topbar-badge" style={{ position:'relative', zIndex:1 }}>AI</div>
          <div className="pipeline-state" style={{ position:'relative', zIndex:1 }}>
            <span className="status-dot" />
            {isGenerating ? 'Pipeline running…' : 'Pipeline ready'}
          </div>
        </header>

        <div className="workspace">
          {/* ── Sidebar ── */}
          <aside className="sidebar">
            <div className="hero-graphic">
              <FilmReelSVG />
              <div style={{
                position:'absolute', width:8, height:8, borderRadius:'50%',
                background:'#ff6b2b', boxShadow:'0 0 10px #ff6b2b',
                animation:'orbit 3.5s linear infinite',
                top:'calc(50% - 4px)', left:'calc(50% - 4px)',
              }} />
            </div>

            <div className="eyebrow">New project</div>
            <h1>Turn a lesson<br />into a <em style={{ color:'#39e75f', fontStyle:'normal' }}>story.</em></h1>
            <p className="intro">A grounded, duration-aware script pipeline<br />for teachers and video teams.</p>

            <label className="upload-zone">
              <input type="file" accept="application/pdf" onChange={e => {
                const f = e.target.files?.[0] ?? null
                setSelectedFile(f); setFileName(f?.name ?? 'No PDF selected'); setGenerationError('')
              }} />
              <div className="upload-icon-wrap"><UploadSVG /></div>
              <strong>{fileName}</strong>
              <small>{selectedFile ? `${(selectedFile.size/1024/1024).toFixed(1)} MB · ready` : 'Click to upload a PDF lesson'}</small>
            </label>

            <div className="form-section-label">Configure</div>
            <div className="form-grid">
              <label>Grade
                <select required aria-label="Grade level" value={grade} onChange={e => setGrade(e.target.value)}>
                  <option value="" disabled>Select</option>
                  {[1,2,3,4,5].map(g => <option key={g} value={String(g)}>Grade {g}</option>)}
                </select>
              </label>
              <label>Duration
                <input required aria-label="Target video duration" placeholder="e.g. 2:20" value={duration} onChange={e => setDuration(e.target.value)} />
              </label>
            </div>

            <div className="style-toggle-wrap">
              <span className="style-toggle-label">Animation style</span>
              <div className="style-toggle">
                <div className={`style-toggle__pill${animationStyle === '3D' ? ' is-3d' : ''}`} />
                <button type="button" className={`style-toggle__btn ${animationStyle==='2D' ? 'active' : 'inactive'}`} onClick={() => setAnimationStyle('2D')}>2D</button>
                <button type="button" className={`style-toggle__btn ${animationStyle==='3D' ? 'active' : 'inactive'}`} onClick={() => setAnimationStyle('3D')}>3D</button>
              </div>
            </div>

            <label>Pages / topics
              <input aria-label="Pages or topics" placeholder="All pages, or 1,3-5" value={pageSelection} onChange={e => setPageSelection(e.target.value)} />
            </label>

            <label>Additional direction
              <textarea value={instructions} onChange={e => setInstructions(e.target.value)}
                        placeholder="E.g. use storytelling metaphors, avoid jargon…" />
            </label>

            <button
              className="generate-button magnetic"
              ref={magnetBtn}
              type="button"
              onClick={generate}
              disabled={isGenerating}
            >
              <span>{isGenerating ? 'Running pipeline…' : 'Generate script'}</span>
              <span className="btn-arrow">
                {isGenerating
                  ? <span className="btn-spinner" />
                  : <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                      <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>}
              </span>
            </button>

            {generationError && <p className="generation-error">⚠ {generationError}</p>}
          </aside>

          {/* ── Content ── */}
          <section className="content">
            <div className="content-heading">
              <div>
                <div className="content-eyebrow">
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                    <circle cx="5" cy="5" r="4" stroke="rgba(57,231,95,0.5)" strokeWidth="1"/>
                    <circle cx="5" cy="5" r="2" fill="#39e75f"/>
                  </svg>
                  {selectedFile ? `Project / ${fileName}` : 'No project loaded'}
                </div>
                <h2>Script <span style={{ color:'#39e75f' }}>workspace</span></h2>
              </div>
              <button className="export-button" type="button" onClick={exportCsv} disabled={!rows.length}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                  <path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Export CSV
              </button>
            </div>

            {/* Pipeline stages */}
            <div className="stage-strip">
              {stages.map((stage, i) => (
                <div key={stage} className={`stage${i < pipelineStage ? ' complete' : ''}`}>
                  <div className="stage-node">
                    {i < pipelineStage
                      ? <svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 5l2.5 2.5L8 3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      : i + 1}
                  </div>
                  <span className="stage-name">{stage}</span>
                </div>
              ))}
            </div>

            {/* Metrics */}
            <div className="metrics">
              {metricCards.map(card => (
                <div key={card.label} className="metric-card"
                     style={{ '--metric-color': card.color } as React.CSSProperties}>
                  <div className="metric-label">{card.label}</div>
                  <div className="metric-value">
                    {card.label === 'Coverage'     && validation ? <AnimatedNumber value={validation.coverage_percent}     suffix="%" /> :
                     card.label === 'Groundedness' && validation ? <AnimatedNumber value={validation.groundedness_percent} suffix="%" /> :
                     card.value}
                  </div>
                  <div className="metric-sub">{card.sub}</div>
                  <div className="metric-bar">
                    <div className="metric-bar-fill" style={{ width:`${card.rawValue}%` }} />
                  </div>
                </div>
              ))}
            </div>

            {/* Tabs */}
            <TabNav activeTab={activeTab} setActiveTab={setActiveTab} rowCount={rows.length} />

            {/* Script */}
            {activeTab === 'script' && (
              rows.length ? (
                <div className="script-table">
                  <div className="table-head">
                    <span>Time</span><span>Visual · {animationStyle||'—'}</span><span>Voice-over</span><span>OTS / SFX</span><span />
                  </div>
                  {rows.map((row, i) => (
                    <article className="script-row" key={`${row.time}-${i}`} style={{ animationDelay:`${i*0.055}s` }}>
                      <div className="time-cell">
                        <strong>{row.time}</strong>
                        <span className="src-tag">📄 {Array.isArray(row.source) ? row.source.join(', ') : row.source}</span>
                      </div>
                      <p>{row.visual}</p>
                      <div className="voice-cell"><WaveformSVG /><p>{row.voice}</p></div>
                      <p className="sfx">{row.sfx}</p>
                      <button className="row-action" title="Regenerate"
                              disabled={regeneratingRow===i} onClick={() => regenerateRow(i)}>
                        {regeneratingRow===i ? <span style={{ display:'block', animation:'spin-slow 0.7s linear infinite' }}>↻</span> : '↻'}
                      </button>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="empty-state">
                  <div className="empty-icon-wrap"><EmptySVG /></div>
                  <h3>Your script will appear here</h3>
                  <p>Upload a lesson PDF, choose grade and duration, then generate a grounded four-column script.</p>
                </div>
              )
            )}

            {/* Checks */}
            {activeTab === 'checks' && (
              validation ? (
                <div className="report-panel">
                  <h3>Validation report</h3>
                  <p>Computed from the uploaded lesson and generated script.</p>
                  {[
                    { label:'Content coverage',      value:`${validation.coverage_percent} / 100` },
                    { label:'Factual grounding',      value:`${validation.groundedness_percent} / 100` },
                    { label:'Grade appropriateness',  value:`Grade ${validation.readability_grade}` },
                    { label:'Estimated duration',     value:fmt(validation.estimated_seconds) },
                    { label:'Source coverage',        value:`${validation.source_pages?.length ?? 0} / ${validation.extracted_pages ?? 0} pages` },
                    { label:'Duration constraint',    value:validation.duration_within_tolerance ? 'Within tolerance' : `${validation.duration_delta_seconds ?? 0}s from target` },
                    { label:'Source pages used',      value:`${validation.source_pages?.length ?? 0} / ${validation.extracted_pages ?? 0}` },
                  ].map(item => (
                    <div key={item.label} className="check-row">
                      <span className="check-mark">✓</span>
                      <strong style={{ color:'var(--text-primary)', fontFamily:'var(--font-head)' }}>{item.label}</strong>
                      <span>{item.value}</span>
                    </div>
                  ))}
                  {validation.pages_without_text?.length ? <p className="generation-error">OCR needed for pages: {validation.pages_without_text.join(', ')}</p> : null}
                </div>
              ) : (
                <div className="empty-state">
                  <div className="empty-icon-wrap"><EmptySVG /></div>
                  <h3>No validation report yet</h3>
                  <p>Generate a script to see coverage, grounding, readability and duration.</p>
                </div>
              )
            )}

            {/* Trace */}
            {activeTab === 'trace' && (
              rows.length ? (
                <div className="report-panel">
                  <h3>Pipeline trace</h3>
                  <p>Intermediate artifacts from this generation run.</p>
                  {['PDF extraction','Content classification','Concept checklist','Section generation','Duration validation','Final assembly'].map((item, i) => (
                    <div key={item} className="trace-row" style={{ animationDelay:`${i*0.05}s` }}>
                      <span className="trace-dot" />
                      <span style={{ color:'var(--text-secondary)' }}>{item}</span>
                      <small>complete</small>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-state">
                  <div className="empty-icon-wrap"><EmptySVG /></div>
                  <h3>No pipeline run yet</h3>
                  <p>Upload a lesson and generate a script to inspect each pipeline stage.</p>
                </div>
              )
            )}
          </section>
        </div>
      </main>
    </>
  )
}

export default App
