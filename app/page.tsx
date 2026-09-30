'use client'

import { useEffect, useRef, useState } from 'react'
import { Expand, Settings2, Sparkles, X } from 'lucide-react'
import { FIXED_SESSION_ID, getWebSocketUrl } from '@/lib/config'
import type { TranslationPair } from '@/lib/types'

export default function TvDisplayPage() {
  const [currentTranslation, setCurrentTranslation] = useState<TranslationPair | null>(null)
  const [showArabic, setShowArabic] = useState(false)
  const [clearAfterSilence, setClearAfterSilence] = useState(true)
  const [silenceDelay, setSilenceDelay] = useState(3)
  const [dark, setDark] = useState(true)
  const [showSettings, setShowSettings] = useState(false)
  const [controlsVisible, setControlsVisible] = useState(true)
  const [isWsConnected, setIsWsConnected] = useState(false)
  const [reconnectTrigger, setReconnectTrigger] = useState(0)

  const wsRef = useRef<WebSocket | null>(null)
  const silenceTimerRef = useRef<number | null>(null)
  const reconnectAttemptsRef = useRef(0)
  const reconnectTimeoutRef = useRef<number | null>(null)
  const hideControlsTimeoutRef = useRef<number | null>(null)

  // Auto-hide controls after 3 seconds of inactivity
  const handleUserActivity = () => {
    setControlsVisible(true)
    if (hideControlsTimeoutRef.current) {
      window.clearTimeout(hideControlsTimeoutRef.current)
    }
    hideControlsTimeoutRef.current = window.setTimeout(() => {
      setControlsVisible(false)
    }, 3000)
  }

  // WebSocket Subscription with Exponential Backoff (2s -> 4s -> 8s -> 10s max)
  useEffect(() => {
    const wsUrl = getWebSocketUrl(FIXED_SESSION_ID)
    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => {
      console.log(`[WS TV] connected session=${FIXED_SESSION_ID}`)
      setIsWsConnected(true)
      reconnectAttemptsRef.current = 0
    }

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)

        if (data.type === 'SESSION_STOPPED' || data.type === 'CLEAR_TRANSLATION') {
          if (silenceTimerRef.current) window.clearTimeout(silenceTimerRef.current)
          setCurrentTranslation(null)
          return
        }

        if (data.type === 'TRANSLATION') {
          if (silenceTimerRef.current) window.clearTimeout(silenceTimerRef.current)

          const { arabic, urdu } = data
          console.log('[WS TV] received translation')

          setCurrentTranslation({ arabic, urdu })

          if (clearAfterSilence) {
            silenceTimerRef.current = window.setTimeout(() => {
              setCurrentTranslation(null)
            }, silenceDelay * 1000)
          }
        }
      } catch (e) {
        console.error('[WS TV] Failed to parse message', e)
      }
    }

    ws.onclose = () => {
      setIsWsConnected(false)
      // Keep last translation visible when disconnected (do not clear currentTranslation)
      const delay = Math.min(2000 * Math.pow(2, reconnectAttemptsRef.current), 10000)
      reconnectAttemptsRef.current += 1
      console.log(`[WS TV] Disconnected, reconnecting in ${delay}ms (attempt ${reconnectAttemptsRef.current})...`)

      if (reconnectTimeoutRef.current) window.clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = window.setTimeout(() => {
        setReconnectTrigger((prev) => prev + 1)
      }, delay)
    }

    return () => {
      ws.onclose = null
      ws.close()
      if (reconnectTimeoutRef.current) window.clearTimeout(reconnectTimeoutRef.current)
      if (silenceTimerRef.current) window.clearTimeout(silenceTimerRef.current)
      if (hideControlsTimeoutRef.current) window.clearTimeout(hideControlsTimeoutRef.current)
    }
  }, [reconnectTrigger, clearAfterSilence, silenceDelay])

  const enterFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen()
      } else {
        await document.exitFullscreen()
      }
    } catch {
      // Ignored if fullscreen API is not permitted
    }
  }

  // Strip mock artifact if present in test environment
  const tvUrduText = currentTranslation?.urdu
    ? currentTranslation.urdu.replace(/\s*\(Mock Translation\)/gi, '').trim()
    : ''

  return (
    <main
      className={`tv-display ${dark ? 'tv-dark' : 'tv-light'}`}
      dir="rtl"
      onMouseMove={handleUserActivity}
      onTouchStart={handleUserActivity}
    >
      <header className="tv-header" dir="ltr">
        <div className="brand-lockup">
          <div className="brand-mark">
            <Sparkles size={16} />
          </div>
          <span>Noor Live</span>
        </div>
        <div className="tv-session">
          <span
            className="live-dot"
            style={!isWsConnected ? { background: '#f59e0b', boxShadow: 'none' } : undefined}
          />{' '}
          LIVE <small>{isWsConnected ? 'translation' : 'reconnecting'}</small>
        </div>
      </header>

      <button
        className="tv-icon-button tv-settings-button"
        onClick={() => setShowSettings(true)}
        aria-label="Open display settings"
      >
        <Settings2 size={17} />
      </button>

      <section className="translation-stage">
        {currentTranslation ? (
          <>
            <div className="stage-kicker">
              {showArabic ? 'Arabic · العربية' : 'Live translation'}
            </div>
            {showArabic && <p className="arabic-line">{currentTranslation.arabic}</p>}
            <div className="ornament" aria-hidden="true">
              <span />
              <i>✦</i>
              <span />
            </div>
            <p className="urdu-line">{tvUrduText}</p>
          </>
        ) : (
          <div className="idle-stage" style={{ textAlign: 'center' }}>
            <div className="stage-kicker">
              LIVE TRANSLATION · الترجمة المباشرة
            </div>
            <p className="arabic-line text-amber-200" style={{ fontSize: 'clamp(28px, 4.5vw, 60px)' }}>
              بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ
            </p>
            <div className="ornament" aria-hidden="true">
              <span />
              <i>✦</i>
              <span />
            </div>
            <p className="urdu-line text-emerald-100" style={{ fontSize: 'clamp(22px, 3.5vw, 44px)', opacity: 0.9 }}>
              خوش آمدید — خطبہ کا براہِ راست ترجمہ جلد شروع ہوگا
            </p>
            <div className="live-waiting-indicator" style={{ marginTop: '28px' }}>
              <span
                className="live-dot"
                style={!isWsConnected ? { background: '#f59e0b', boxShadow: 'none' } : undefined}
              />{' '}
              {isWsConnected ? 'LIVE' : 'RECONNECTING'}
            </div>
          </div>
        )}
      </section>

      <footer className="tv-footer" dir="ltr">
        <span>Masjid Al Noor</span>
        <span className="footer-divider" />
        <span>Arabic → Urdu</span>
      </footer>

      <div
        className={`tv-controls ${controlsVisible ? 'is-visible' : ''}`}
        dir="ltr"
      >
        <button
          className="tv-icon-button"
          onClick={enterFullscreen}
          aria-label="Toggle fullscreen"
        >
          <Expand size={17} />
        </button>
      </div>

      {showSettings && (
        <div className="mini-settings" dir="ltr">
          <div className="mini-settings-head">
            <span>Display settings</span>
            <button onClick={() => setShowSettings(false)} aria-label="Close settings">
              <X size={16} />
            </button>
          </div>
          <label className="switch-row">
            <span>Show Arabic text</span>
            <input
              type="checkbox"
              checked={showArabic}
              onChange={(event) => setShowArabic(event.target.checked)}
            />
            <span className="switch" />
          </label>
          <label className="switch-row">
            <span>Clear translation after silence</span>
            <input
              type="checkbox"
              checked={clearAfterSilence}
              onChange={(event) => setClearAfterSilence(event.target.checked)}
            />
            <span className="switch" />
          </label>
          {clearAfterSilence && (
            <label className="delay-row">
              <span>Clear after</span>
              <select
                value={silenceDelay}
                onChange={(event) => setSilenceDelay(Number(event.target.value))}
              >
                <option value={1}>1 second</option>
                <option value={3}>3 seconds</option>
                <option value={5}>5 seconds</option>
                <option value={10}>10 seconds</option>
              </select>
            </label>
          )}
          <label className="switch-row">
            <span>Light theme</span>
            <input
              type="checkbox"
              checked={!dark}
              onChange={() => setDark(!dark)}
            />
            <span className="switch" />
          </label>
        </div>
      )}
    </main>
  )
}
