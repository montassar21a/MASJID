'use client'

import { useEffect, useRef, useState } from 'react'
import {
  Activity,
  Check,
  ChevronDown,
  CircleHelp,
  Copy,
  Expand,
  Gauge,
  Globe2,
  Headphones,
  Layers3,
  Menu,
  Mic,
  MonitorPlay,
  Moon,
  Play,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Square,
  Sun,
  Volume2,
  Wifi,
  X,
} from 'lucide-react'

type View = 'admin' | 'display'
type DisplayMode = 'live' | 'subtitles'
type SessionState = 'WAITING' | 'LISTENING' | 'PROCESSING' | 'TRANSLATING' | 'DISPLAYING' | 'SILENT' | 'CONNECTED' | 'RECONNECTING' | 'MICROPHONE_ERROR' | 'PERMISSION_REQUIRED' | 'ENDED'

type SpeechRecognitionEventLike = Event & { results: { [index: number]: { [index: number]: { transcript: string; isFinal?: boolean } } }; resultIndex: number }
type SpeechRecognitionLike = { continuous: boolean; interimResults: boolean; lang: string; onresult: ((event: SpeechRecognitionEventLike) => void) | null; onend: (() => void) | null; onerror: ((event: { error: string }) => void) | null; start: () => void; stop: () => void }
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike

type TranslationPair = {
  arabic: string;
  urdu: string;
}

export default function Page() {
  const [view, setView] = useState<View>('admin')
  const [sessionId, setSessionId] = useState<string>('')
  const [isListening, setIsListening] = useState(true)
  const [showSettings, setShowSettings] = useState(false)
  const [showArabic, setShowArabic] = useState(false)
  const [displayMode, setDisplayMode] = useState<DisplayMode>('live')
  const [clearAfterSilence, setClearAfterSilence] = useState(true)
  const [silenceDelay, setSilenceDelay] = useState(3)
  const [currentTranslation, setCurrentTranslation] = useState<TranslationPair | null>(null)
  const [recentPhrases, setRecentPhrases] = useState<TranslationPair[]>([])
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [dark, setDark] = useState(true)
  const [sessionState, setSessionState] = useState<SessionState>('CONNECTED')
  const [permissionRequired, setPermissionRequired] = useState(false)
  const [controlsVisible, setControlsVisible] = useState(true)
  const [providerLabel, setProviderLabel] = useState<string>('')
  const [reconnectAttempt, setReconnectAttempt] = useState(0)

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const retryRef = useRef(0)
  const wsRef = useRef<WebSocket | null>(null)
  const silenceTimerRef = useRef<number | null>(null)
  
  const [latency, setLatency] = useState<number | null>(null)

  useEffect(() => {
    // Query active translation provider status without exposing secrets
    fetch('/api/translate')
      .then((res) => res.json())
      .then((data) => {
        if (data.testMode) {
          setProviderLabel('TEST MODE — Translation provider disabled')
        } else if (data.provider === 'openrouter') {
          setProviderLabel('Translation Provider: OpenRouter')
        } else if (data.provider === 'libretranslate') {
          setProviderLabel('Provider: LibreTranslate')
        } else {
          setProviderLabel('Provider: Gemini')
        }
      })
      .catch(() => {
        setProviderLabel('Provider: Gemini')
      })
  }, [])

  useEffect(() => {
    // Get session ID or load stable saved session
    const params = new URLSearchParams(window.location.search);
    let session = params.get('session');
    
    const viewParam = params.get('view');
    if (window.location.pathname.includes('/display') || viewParam === 'display') {
      setView('display')
    }

    if (!session && typeof window !== 'undefined') {
      try {
        session = localStorage.getItem('noor_live_session') || sessionStorage.getItem('noor_live_session');
      } catch (e) {
        console.warn('Could not read session from storage:', e);
      }
    }

    if (!session) {
      session = 'mosque-724034';
    }

    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('noor_live_session', session);
      } catch (e) {
        // Storage quota exceeded or disabled in private mode; fallback to sessionStorage
        try {
          sessionStorage.setItem('noor_live_session', session);
        } catch {
          // In-memory / URL fallback
        }
      }
      try {
        const newUrl = new URL(window.location.href);
        newUrl.searchParams.set('session', session);
        window.history.replaceState({}, '', newUrl);
      } catch (e) {
        console.warn('Could not update URL history state:', e);
      }
    }
    setSessionId(session)
  }, [])

  const clearCurrentTranslationFromChannel = () => {
    if (silenceTimerRef.current) window.clearTimeout(silenceTimerRef.current)
    setCurrentTranslation(null)
    setSessionState('WAITING')
  }

  useEffect(() => {
    if (!sessionId) return;

    let wsUrl = process.env.NEXT_PUBLIC_WEBSOCKET_URL || 'ws://localhost:8080';
    // If client is on a different device on LAN (e.g. 192.168.x.x), connect to that host's port 8080
    if (typeof window !== 'undefined') {
      const isLocalhostConfig = wsUrl.includes('localhost') || wsUrl.includes('127.0.0.1');
      if (isLocalhostConfig && window.location.hostname && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
        const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        wsUrl = `${wsProto}//${window.location.hostname}:8080`;
      }
    }

    // Connect WebSocket
    const ws = new WebSocket(`${wsUrl}?session=${sessionId}`)
    wsRef.current = ws;

    ws.onopen = () => {
      if (view === 'display') {
        console.log(`[WS TV] connected session=${sessionId}`);
      } else {
        console.log(`[WS ADMIN] connected session=${sessionId}`);
      }
      setSessionState(prev => prev === 'RECONNECTING' ? (isListening ? 'LISTENING' : 'CONNECTED') : prev)
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        if (data.type === 'SESSION_STOPPED') {
          clearCurrentTranslationFromChannel()
          return
        }
        
        if (data.type === 'TRANSLATION') {
          if (silenceTimerRef.current) window.clearTimeout(silenceTimerRef.current)
          
          const { arabic, urdu, timestamp } = data;
          
          if (view === 'display') {
            console.log('[WS TV] received translation');
            console.log('[TV] translation state updated');
          }
          
          const pair = { arabic, urdu };
          setCurrentTranslation(pair)
          setSessionState('DISPLAYING')
          
          if (timestamp) {
            const ms = Date.now() - timestamp;
            setLatency(ms);
          }
          
          if (clearAfterSilence) {
            silenceTimerRef.current = window.setTimeout(() => {
              setCurrentTranslation(null)
              setSessionState('WAITING')
            }, silenceDelay * 1000)
          }
        }

        if (data.type === 'CLEAR_TRANSLATION') {
          clearCurrentTranslationFromChannel();
        }
      } catch(e) {
        console.error("Failed to parse websocket message", e);
      }
    }

    ws.onclose = () => {
      console.log('[WebSocket] Disconnected, reconnecting...');
      setSessionState('RECONNECTING');
      // Trigger reconnection attempt
      setTimeout(() => {
        setReconnectAttempt((prev) => prev + 1);
      }, 3000);
    }

    return () => {
      ws.onclose = null;
      ws.close()
    }
  }, [sessionId, clearAfterSilence, silenceDelay, reconnectAttempt, view, isListening])

  const lastTranslatedTextRef = useRef<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (view !== 'admin' || !isListening) return
    const SpeechRecognition = (window as typeof window & { SpeechRecognition?: SpeechRecognitionConstructor; webkitSpeechRecognition?: SpeechRecognitionConstructor }).SpeechRecognition ?? (window as typeof window & { webkitSpeechRecognition?: SpeechRecognitionConstructor }).webkitSpeechRecognition
    if (!SpeechRecognition) { setSessionState('MICROPHONE_ERROR'); return }
    const recognition = new SpeechRecognition()
    recognition.continuous = true
    recognition.interimResults = false
    recognition.lang = 'ar-SA'
    
    recognition.onresult = async (event) => {
      const result = event.results[event.resultIndex]?.[0]
      const transcript = result?.transcript?.trim()
      
      // Ensure we only process final results and non-empty text
      if (!transcript || result?.isFinal === false) return
      
      // Deduplication: prevent sending the exact same phrase multiple times consecutively
      if (transcript === lastTranslatedTextRef.current) {
        console.log('[v0] DUPLICATE SPEECH IGNORED', transcript)
        return
      }
      lastTranslatedTextRef.current = transcript;
      
      console.log('[v0] FINAL SPEECH DETECTED', transcript)
      setSessionState('PROCESSING')
      
      const startMark = Date.now();
      
      try {
        setSessionState('TRANSLATING')
        setErrorMessage(null); // Clear previous errors
        
        const response = await fetch('/api/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: transcript,
            sourceLanguage: 'ar',
            targetLanguage: 'ur'
          })
        });
        
        if (!response.ok) {
          let errMessage = 'Translation API failed';
          try {
             const errData = await response.json();
             errMessage = errData.error + (errData.details ? `: ${errData.details}` : '');
          } catch(e) {}
          throw new Error(errMessage);
        }
        
        const data = await response.json();
        if (data.error) throw new Error(data.error + (data.details ? `: ${data.details}` : ''));
        
        const urdu = data.translation;
        console.log('[v0] URDU RESULT', urdu)
        
        const phrase = { arabic: transcript, urdu };
        setCurrentTranslation(phrase)
        setRecentPhrases((items) => [...items.filter((item) => item.arabic !== phrase.arabic), phrase].slice(-3))
        
        const payload = {
           type: 'TRANSLATION',
           sessionId,
           arabic: phrase.arabic,
           urdu: phrase.urdu,
           timestamp: startMark
        };
        
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          console.log('[WS ADMIN] sending translation');
          wsRef.current.send(JSON.stringify(payload));
        }
        
      } catch (e: any) {
        console.error("Translation error:", e);
        const errStr = e.message || String(e);
        
        if (errStr.includes('503') || errStr.includes('Temporarily Unavailable') || errStr.includes('connection timeout')) {
          const providerName = errStr.includes('OpenRouter') ? 'OpenRouter' : (errStr.includes('LibreTranslate') ? 'LibreTranslate' : 'Gemini');
          setErrorMessage(`${providerName} temporarily unavailable. Retrying on next sentence...`);
        } else if (errStr.includes('Quota Exceeded') || errStr.includes('429')) {
          const providerName = errStr.includes('OpenRouter') ? 'OpenRouter' : (errStr.includes('LibreTranslate') ? 'LibreTranslate' : 'Gemini');
          setErrorMessage(`${providerName} API quota exceeded.`);
          setIsListening(false); // Stop listening to prevent loops
          setSessionState('ENDED');
        } else if (errStr.includes('Authentication Error') || errStr.includes('Model Not Found') || errStr.includes('Model Error') || errStr.includes('No endpoints found')) {
          setErrorMessage(errStr);
          setIsListening(false);
          setSessionState('ENDED');
        } else {
          setErrorMessage(errStr);
        }
      } finally {
        if (isListening) {
          window.setTimeout(() => setSessionState('LISTENING'), 150)
        }
      }
    }
    
    recognition.onerror = (event) => {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') { setPermissionRequired(true); setSessionState('PERMISSION_REQUIRED') }
      else setSessionState('RECONNECTING')
    }
    
    recognition.onend = () => {
      if (!isListening) return
      setSessionState('RECONNECTING')
      const delay = Math.min(1000 * 2 ** retryRef.current, 8000)
      retryRef.current += 1
      window.setTimeout(() => { 
        if (isListening) { 
          try { recognition.start(); setSessionState('LISTENING') } catch { setSessionState('RECONNECTING') } 
        } 
      }, delay)
    }
    
    recognitionRef.current = recognition
    try { recognition.start(); setSessionState('LISTENING'); setPermissionRequired(false) } catch { setSessionState('RECONNECTING') }
    return () => { recognition.onend = null; recognition.stop(); recognitionRef.current = null }
  }, [view, isListening, sessionId])

  const current = currentTranslation
  
  const clearCurrentTranslation = () => {
    if (silenceTimerRef.current) window.clearTimeout(silenceTimerRef.current)
    setCurrentTranslation(null)
    setSessionState('WAITING')
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'CLEAR_TRANSLATION', sessionId }));
    }
  }
  
  const stopListening = () => {
    setIsListening(false)
    clearCurrentTranslation()
    setRecentPhrases([])
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'SESSION_STOPPED', sessionId }));
    }
    setSessionState('ENDED')
  }
  
  const enterFullscreen = async () => {
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen()
      else await document.exitFullscreen()
      setIsFullscreen(Boolean(document.fullscreenElement))
    } catch {
      setIsFullscreen(false)
    }
  }

  if (view === 'display') {
    // Strip (Mock Translation) from TV public display
    const tvUrduText = current?.urdu ? current.urdu.replace(/\s*\(Mock Translation\)/gi, '').trim() : '';

    return (
      <main className={`tv-display ${dark ? 'tv-dark' : 'tv-light'}`} dir="rtl" onMouseMove={() => setControlsVisible(true)} onTouchStart={() => setControlsVisible(true)}>
        <div className="tv-aura" aria-hidden="true" />

        <header className="tv-header" dir="ltr">
          <div className="brand-lockup">
            <div className="brand-mark"><Sparkles size={16} /></div>
            <span>Noor Live</span>
          </div>
          <div className="tv-session"><span className="live-dot" /> LIVE <small>{sessionState === 'RECONNECTING' ? 'reconnecting' : 'translation'}</small></div>
        </header>
        <button className="tv-icon-button tv-settings-button" onClick={() => setShowSettings(true)} aria-label="Open display settings"><Settings2 size={17} /></button>
        <section className="translation-stage">
          <div className="stage-kicker">{showArabic ? 'Arabic · العربية' : 'Live translation'}</div>
          {current ? <>
            {showArabic && <p className="arabic-line">{current.arabic}</p>}
            <div className="ornament" aria-hidden="true"><span /><i>✦</i><span /></div>
            <p className="urdu-line">{tvUrduText}</p>
          </> : <p className="live-waiting-indicator"><span className="live-dot" /> LIVE</p>}
        </section>
        <footer className="tv-footer" dir="ltr"><span>Masjid Al Noor</span><span className="footer-divider" /><span>Arabic → Urdu</span></footer>
        <div className={`tv-controls ${controlsVisible ? 'is-visible' : ''}`} dir="ltr" onMouseLeave={() => window.setTimeout(() => setControlsVisible(false), 3000)}>
          <button className="tv-icon-button" onClick={() => isListening ? stopListening() : setIsListening(true)} aria-label={isListening ? 'Stop listening' : 'Start listening'}>{isListening ? <Square size={15} /> : <Play size={15} />}</button>
          <button className="tv-icon-button" onClick={enterFullscreen} aria-label="Toggle fullscreen"><Expand size={17} /></button>
        </div>
        {showSettings && <div className="mini-settings" dir="ltr"><div className="mini-settings-head"><span>Display settings</span><button onClick={() => setShowSettings(false)} aria-label="Close settings"><X size={16} /></button></div><label className="switch-row"><span>Show Arabic text</span><input type="checkbox" checked={showArabic} onChange={(event) => setShowArabic(event.target.checked)} /><span className="switch" /></label><label className="switch-row"><span>Clear translation after silence</span><input type="checkbox" checked={clearAfterSilence} onChange={(event) => setClearAfterSilence(event.target.checked)} /><span className="switch" /></label>{clearAfterSilence && <label className="delay-row"><span>Clear after</span><select value={silenceDelay} onChange={(event) => setSilenceDelay(Number(event.target.value))}><option value={1}>1 second</option><option value={3}>3 seconds</option><option value={5}>5 seconds</option><option value={10}>10 seconds</option></select></label>}<label className="switch-row"><span>Light theme</span><input type="checkbox" checked={!dark} onChange={() => setDark(!dark)} /><span className="switch" /></label></div>}
      </main>
    )
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="side-brand"><div className="brand-mark"><Sparkles size={17} /></div><div><strong>Noor Live</strong><small>TRANSLATION STUDIO</small></div></div>
        <div className="nav-label">Workspace</div>
        <nav className="nav-list"><button className="nav-item active"><Activity size={17} /> Live session</button><button className="nav-item" onClick={() => window.open(window.location.pathname + '?session=' + sessionId + '&view=display', '_blank')}><MonitorPlay size={17} /> TV display <span className="nav-arrow">↗</span></button><button className="nav-item"><Layers3 size={17} /> Session history</button></nav>
        <div className="sidebar-bottom"><div className="help-card"><CircleHelp size={17} /><div><strong>Need a hand?</strong><span>Read the quick setup guide</span></div></div><div className="account-row"><div className="avatar">MN</div><div><strong>Masjid Al Noor</strong><span>Administrator</span></div><ChevronDown size={15} /></div></div>
      </aside>
      <section className="workspace">
        <header className="topbar">
          <div className="mobile-brand"><div className="brand-mark"><Sparkles size={15} /></div><strong>Noor Live</strong></div>
          <div className="topbar-spacer" />
          <div className="connection">
            <span className="status-dot" /> System operational{providerLabel ? ` · ${providerLabel}` : ''}
          </div>
          <button className="icon-button"><Menu size={18} /></button>
        </header>
        <div className="content-wrap">
          <div className="page-heading"><div><div className="eyebrow"><span className="pulse-ring" /> SESSION {sessionId}</div><h1>Live session</h1><p>Translate Arabic speech into Urdu, in real time.</p></div><div className="heading-actions"><button className="button secondary" onClick={() => window.open(window.location.pathname + '?session=' + sessionId + '&view=display', '_blank')}><MonitorPlay size={16} /> Open TV display</button><button className="button secondary" title="Copy TV display link for other devices" onClick={() => {
            const tvUrl = `${window.location.origin}${window.location.pathname}?session=${sessionId}&view=display`;
            navigator.clipboard.writeText(tvUrl);
            alert('TV link copied!\n\nOpen this link on other devices:\n' + tvUrl);
          }}><Copy size={16} /> Copy TV link</button><button className="button primary" onClick={() => isListening ? stopListening() : setIsListening(true)}>{isListening ? <Square size={15} /> : <Play size={15} />}{isListening ? 'Stop session' : 'Start session'}</button></div></div>
          <div className="metrics"><div className="metric-card"><div className="metric-icon green"><Wifi size={17} /></div><div><span>Connection</span><strong>Excellent</strong></div><small>WebSocket Active</small></div><div className="metric-card"><div className="metric-icon blue"><Mic size={17} /></div><div><span>Microphone</span><strong>{permissionRequired ? 'Permission Needed' : (isListening ? 'Active' : 'Stopped')}</strong></div><small className="level-bars"><i /><i /><i /><i /><i /></small></div><div className="metric-card"><div className="metric-icon gold"><Gauge size={17} /></div><div><span>Translation latency</span><strong>{latency !== null ? `~ ${(latency / 1000).toFixed(1)} sec` : 'Measuring...'}</strong></div><small>Target 2.0 sec</small></div></div>
          {errorMessage && <div style={{backgroundColor: '#ffebee', color: '#c62828', padding: '12px', borderRadius: '8px', marginBottom: '16px', fontWeight: 'bold'}}>{errorMessage}</div>}
          <div className="main-grid"><section className="panel live-panel"><div className="panel-heading"><div><div className="panel-title"><span className="recording-dot" /> Live preview</div><p>What your audience sees on the TV</p></div><div className="mode-tabs"><button className={displayMode === 'live' ? 'selected' : ''} onClick={() => setDisplayMode('live')}>Live</button><button className={displayMode === 'subtitles' ? 'selected' : ''} onClick={() => setDisplayMode('subtitles')}>Subtitles</button></div></div><div className={`preview-screen ${dark ? 'tv-dark' : 'tv-light'}`} dir="rtl"><div className="preview-top" dir="ltr"><span>NOOR LIVE</span><span><span className="live-dot" /> LIVE</span></div><div className="preview-copy">{current ? <>{showArabic && <div className="preview-arabic">{current.arabic}</div>}<div className="preview-divider"><span /><i>✦</i><span /></div><div className="preview-urdu">{current.urdu}</div></> : <div className="live-waiting-indicator"><span className="live-dot" /> LIVE</div>}</div><div className="preview-bottom" dir="ltr"><span>Masjid Al Noor</span><span>Arabic → Urdu</span></div></div><div className="preview-footer"><span><span className="status-dot" /> Sending to TV display via WS</span><button className="text-button" onClick={() => window.open(window.location.pathname + '?session=' + sessionId + '&view=display', '_blank')}>Open full display <span>↗</span></button></div></section>
            <aside className="panel settings-panel"><div className="panel-heading"><div><div className="panel-title">Quick settings</div><p>Adjust the live experience</p></div><button className="icon-button" onClick={() => setShowSettings(!showSettings)}><SlidersHorizontal size={17} /></button></div><div className="setting-block"><div className="setting-label"><span>Translation pair</span><strong>Arabic <span>→</span> Urdu</strong></div><div className="language-select"><Globe2 size={16} /><span>Arabic</span><span className="select-arrow">→</span><span>Urdu</span><ChevronDown size={15} /></div></div><div className="setting-block"><div className="setting-label"><span>Microphone input</span><strong className="green-text"><span className="status-dot" /> Connected</strong></div><div className="input-select"><Mic size={16} /><span>System Default</span><ChevronDown size={15} /></div></div><div className="setting-block"><div className="setting-label"><span>TV display</span><strong>{showArabic ? 'Arabic visible' : 'Urdu only'}</strong></div><label className="switch-row"><span>Show Arabic text</span><input type="checkbox" checked={showArabic} onChange={(event) => setShowArabic(event.target.checked)} /><span className="switch" /></label><label className="switch-row"><span>Auto-scroll translations</span><input type="checkbox" defaultChecked /><span className="switch" /></label></div><button className="button wide secondary" onClick={() => setShowSettings(true)}><Settings2 size={15} /> All display settings</button></aside></div>
          <section className="recent-section"><div className="section-heading"><div><h2>Recent translations</h2><p>Sentences from this live session</p></div><button className="text-button">View session history <span>↗</span></button></div><div className="translation-list">{recentPhrases.length === 0 ? <div className="empty-translations">Speak in Arabic to begin the live translation.</div> : recentPhrases.map((phrase, index) => <div className={`translation-row ${current?.arabic === phrase.arabic ? 'current' : ''}`} key={phrase.arabic + index}><span className="translation-time">{current?.arabic === phrase.arabic ? <><span className="now-dot" />{'NOW'}</> : 'RECENT'}</span><div className="translation-arabic" dir="rtl">{phrase.arabic}</div><div className="translation-urdu" dir="rtl">{phrase.urdu}</div>{current?.arabic === phrase.arabic && <Check size={16} className="check-icon" />}</div>)}</div></section>
        </div>
      </section>
    </main>
  )
}
