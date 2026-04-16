import { mkdirSync, openSync, writeSync, closeSync, readFileSync, unlinkSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

const CLAUDEGRAM_DIR = join(homedir(), '.claudegram')
const PID_FILE = join(CLAUDEGRAM_DIR, 'daemon.pid')

export function acquirePidLock(): void {
  mkdirSync(CLAUDEGRAM_DIR, { recursive: true })

  try {
    // Atomic exclusive-create — fails with EEXIST if file already exists
    const fd = openSync(PID_FILE, 'wx')
    writeSync(fd, String(process.pid))
    closeSync(fd)
  } catch (err: unknown) {
    const nodeErr = err as NodeJS.ErrnoException
    if (nodeErr.code !== 'EEXIST') throw err

    // File exists — check if the owning process is still alive
    let existingPid: number
    try {
      existingPid = parseInt(readFileSync(PID_FILE, 'utf8').trim(), 10)
    } catch {
      // PID file disappeared between the open and read — safe to retry
      acquirePidLock()
      return
    }

    if (!isNaN(existingPid)) {
      try {
        process.kill(existingPid, 0)
        // Signal succeeded — process is alive
        throw new Error(`Daemon already running. Stop it first with: kill ${existingPid}`)
      } catch (killErr: unknown) {
        const killNodeErr = killErr as NodeJS.ErrnoException
        if (killNodeErr.code === 'EPERM') {
          // Process is alive but owned by another user — treat as alive
          throw new Error(`Daemon already running (insufficient permissions to check PID ${existingPid}).`)
        }
        if (killNodeErr.code === 'ESRCH') {
          // Process is dead — remove stale file and write ours
          process.stderr.write(`[claudegram-daemon] Removing stale PID file (PID ${existingPid} is no longer running).\n`)
          unlinkSync(PID_FILE)
          acquirePidLock()
          return
        }
        throw killErr
      }
    }
  }
}

export function releasePidLock(): void {
  try {
    const stored = readFileSync(PID_FILE, 'utf8').trim()
    if (parseInt(stored, 10) === process.pid) {
      unlinkSync(PID_FILE)
    }
  } catch {
    // File already gone — nothing to do
  }
}
