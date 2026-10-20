import fs from 'node:fs'
import path from 'node:path'
import { spawn, type ChildProcessByStdio } from 'node:child_process'
import type { Readable, Writable } from 'node:stream'
import { app, BrowserWindow } from 'electron'

type LiveConfig = { endpoint: string; streamKey: string; width: number; height: number; fps: number; bitrate: number }
let encoder: ChildProcessByStdio<Writable, null, Readable> | null = null
let stopping = false
let started = false
let stderrTail = ''
let activeSecret = ''

const status = (state: 'connecting' | 'live' | 'stopped' | 'error', message: string) => {
  for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send('lumen:live:status', { state, message })
}

function executable() {
  const bundled = app.isPackaged ? path.join(process.resourcesPath, 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg') : path.join(app.getAppPath(), 'native', 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
  return fs.existsSync(bundled) ? bundled : process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
}

export function startLive(input: LiveConfig) {
  if (encoder) throw new Error('A live stream is already running.')
  const endpoint = input.endpoint.trim().replace(/\/+$/, '')
  if (!/^rtmps?:\/\//i.test(endpoint) || /[\r\n\0]/.test(endpoint)) throw new Error('Enter a valid RTMP or RTMPS server address.')
  if (!input.streamKey.trim() || /[\r\n\0]/.test(input.streamKey)) throw new Error('Enter a valid stream key.')
  const width = Math.max(320, Math.min(3840, Math.round(input.width / 2) * 2))
  const height = Math.max(240, Math.min(2160, Math.round(input.height / 2) * 2))
  const fps = Math.max(15, Math.min(60, Math.round(input.fps)))
  const bitrate = Math.max(1_000_000, Math.min(24_000_000, Math.round(input.bitrate)))
  const target = `${endpoint}/${encodeURIComponent(input.streamKey.trim())}`
  const args = [
    '-hide_banner', '-loglevel', 'warning', '-thread_queue_size', '512', '-f', 'webm', '-i', 'pipe:0',
    '-map', '0:v:0', '-map', '0:a:0?', '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency',
    '-vf', `scale=${width}:${height}`, '-pix_fmt', 'yuv420p', '-r', String(fps), '-b:v', String(bitrate), '-maxrate', String(bitrate), '-bufsize', String(bitrate * 2), '-g', String(fps * 2),
    '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-f', 'flv', target,
  ]
  stopping = false
  started = false
  stderrTail = ''
  activeSecret = input.streamKey.trim()
  const child = spawn(executable(), args, { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] })
  encoder = child
  status('connecting', 'Connecting to the streaming server…')
  child.stderr.on('data', (chunk: Buffer) => {
    stderrTail = (stderrTail + chunk.toString('utf8')).slice(-4000)
    if (!started && /Output #0|Press \[q\]|frame=\s*\d+/i.test(stderrTail)) {
      started = true
      status('live', 'Connected and sending the live program.')
    }
  })
  child.on('error', (err) => {
    const missing = (err as NodeJS.ErrnoException).code === 'ENOENT'
    status('error', missing ? 'FFmpeg was not found. Install FFmpeg or place it in Faro’s native/bin folder.' : err.message)
    encoder = null
  })
  child.on('close', (code) => {
    const expected = stopping
    encoder = null
    if (expected) status('stopped', 'Stream stopped.')
    else if (code !== 0) status('error', (stderrTail.split(/\r?\n/).filter(Boolean).slice(-3).join(' ') || `FFmpeg stopped with code ${code}.`).replaceAll(activeSecret, '[stream key]').replaceAll(encodeURIComponent(activeSecret), '[stream key]'))
    else status('stopped', 'The streaming server ended the stream.')
  })
}

export function sendLive(data: Uint8Array) {
  if (!encoder?.stdin.writable) return
  if (!(data instanceof Uint8Array) || data.byteLength > 16 * 1024 * 1024) return
  if (encoder.stdin.writableLength > 24 * 1024 * 1024) {
    stopLive()
    status('error', 'The encoder cannot keep up with the camera. Lower the stream resolution or frame rate.')
    return
  }
  encoder.stdin.write(Buffer.from(data.buffer, data.byteOffset, data.byteLength))
  if (!started) {
    started = true
    status('live', 'Sending the live program to the streaming server…')
  }
}

export async function stopLive() {
  const child = encoder
  if (!child) return
  stopping = true
  child.stdin.end()
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      resolve()
    }, 5000)
    child.once('close', () => { clearTimeout(timer); resolve() })
  })
}
