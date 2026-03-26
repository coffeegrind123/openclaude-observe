import { useEffect, useRef, useState, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { WS_URL, API_BASE } from '@/config/api'
import type { WSMessage } from '@/types'

export function useWebSocket() {
  const queryClient = useQueryClient()
  const wsRef = useRef<WebSocket | null>(null)
  const [connected, setConnected] = useState(false)
  const [mode, setMode] = useState<'ws' | 'polling' | 'connecting'>('connecting')
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const pollIntervalRef = useRef<ReturnType<typeof setInterval>>(undefined)
  const lastPollTimestampRef = useRef<number>(Date.now())
  const wsFailCountRef = useRef(0)

  const invalidateAll = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['events'] })
    queryClient.invalidateQueries({ queryKey: ['agents'] })
    queryClient.invalidateQueries({ queryKey: ['sessions'] })
    queryClient.invalidateQueries({ queryKey: ['projects'] })
  }, [queryClient])

  // Polling fallback
  const startPolling = useCallback(() => {
    if (pollIntervalRef.current) return
    setMode('polling')
    setConnected(true)
    console.log('[Poll] Starting polling mode')

    pollIntervalRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/poll?since=${lastPollTimestampRef.current}`)
        if (!res.ok) return
        const events = await res.json()
        if (events.length > 0) {
          lastPollTimestampRef.current = Math.max(...events.map((e: any) => e.timestamp))
          invalidateAll()
        }
      } catch {
        // Silently fail
      }
    }, 3000)
  }, [invalidateAll])

  const stopPolling = () => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current)
      pollIntervalRef.current = undefined
    }
  }

  useEffect(() => {
    if (wsRef.current && wsRef.current.readyState <= WebSocket.OPEN) {
      return
    }

    function connectWs() {
      try {
        const ws = new WebSocket(WS_URL)
        wsRef.current = ws

        ws.onopen = () => {
          setConnected(true)
          setMode('ws')
          wsFailCountRef.current = 0
          stopPolling()
          console.log('[WS] Connected')
        }

        ws.onmessage = (event) => {
          try {
            const msg: WSMessage = JSON.parse(event.data)
            if (
              msg.type === 'event' ||
              msg.type === 'agent_update' ||
              msg.type === 'session_update'
            ) {
              invalidateAll()
            }
          } catch {}
        }

        ws.onclose = () => {
          setConnected(false)
          wsRef.current = null
          wsFailCountRef.current++

          if (wsFailCountRef.current >= 2) {
            // Give up on WS, switch to polling
            console.log('[WS] Failed to connect, switching to polling')
            startPolling()
          } else {
            console.log('[WS] Disconnected, retrying in 3s...')
            reconnectTimeoutRef.current = setTimeout(connectWs, 3000)
          }
        }

        ws.onerror = () => {
          ws.close()
        }
      } catch {
        // WebSocket constructor can throw if URL is invalid
        wsFailCountRef.current = 2
        startPolling()
      }
    }

    connectWs()

    return () => {
      clearTimeout(reconnectTimeoutRef.current)
      stopPolling()
      wsRef.current?.close()
      wsRef.current = null
    }
  }, [queryClient, invalidateAll, startPolling])

  return { connected, mode }
}
