#!/usr/bin/env node
// Rebuild the desktop payload's node_modules from the Next.js NFT traces,
// then Windows-ify the payload for the electron-builder NSIS installer.
//
// Phases:
//   node scripts/assemble-standalone.js trace   -> .next-prod/standalone/node_modules from traces (+ safety nets)
//   node scripts/assemble-standalone.js winify  -> drop linux natives, add @img/sharp-win32-x64, report remaining natives
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const ROOT = '/home/z/my-project'
const DIST = path.join(ROOT, '.next-prod')
const STANDALONE = path.join(DIST, 'standalone')
const OUT_NM = path.join(STANDALONE, 'node_modules')
const SRC_NM = path.join(ROOT, 'node_modules')

function walkNft(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'cache' || e.name === 'trace-build' || e.name === 'types' || e.name === 'node_modules') continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walkNft(p, acc)
    else if (e.name.endsWith('.nft.json')) acc.push(p)
  }
  return acc
}

function copyFile(src, dest) {
  let st
  try { st = fs.lstatSync(src) } catch { return 'missing' }
  if (st.isSymbolicLink()) {
    let target
    try { target = fs.realpathSync(src) } catch { return 'dangling' }
    try { st = fs.lstatSync(target) } catch { return 'dangling' }
    src = target
  }
  if (!st.isFile()) return 'notfile'
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.copyFileSync(src, dest)
  return 'ok'
}

function copyDir(src, dest) {
  const st = fs.lstatSync(src)
  if (st.isSymbolicLink()) src = fs.realpathSync(src)
  fs.mkdirSync(dest, { recursive: true })
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name)
    const d = path.join(dest, e.name)
    if (e.isDirectory()) copyDir(s, d)
    else if (e.isSymbolicLink()) {
      let t
      try { t = fs.realpathSync(s) } catch { continue }
      const ts = fs.lstatSync(t)
      if (ts.isDirectory()) copyDir(t, d)
      else { fs.mkdirSync(path.dirname(d), { recursive: true }); fs.copyFileSync(t, d) }
    } else if (e.isFile()) {
      fs.mkdirSync(path.dirname(d), { recursive: true })
      fs.copyFileSync(s, d)
    }
  }
}

function duMB(p) {
  return execSync(`du -sm "${p}"`).toString().trim().split(/\s+/)[0]
}

function phaseTrace() {
  fs.rmSync(OUT_NM, { recursive: true, force: true })
  fs.mkdirSync(OUT_NM, { recursive: true })
  const traces = walkNft(DIST)
  console.log(`found ${traces.length} NFT trace files`)
  const stats = { ok: 0, missing: 0, dangling: 0, notfile: 0 }
  const skipped = new Set()
  const seen = new Set()
  for (const t of traces) {
    const base = path.dirname(t)
    let j
    try { j = JSON.parse(fs.readFileSync(t, 'utf8')) } catch { continue }
    for (const f of j.files || []) {
      const abs = path.resolve(base, f)
      if (seen.has(abs)) continue
      seen.add(abs)
      if (!abs.startsWith(ROOT + path.sep)) continue
      const idx = abs.indexOf(`${path.sep}node_modules${path.sep}`)
      if (idx === -1) continue
      const rel = abs.slice(idx + 'node_modules/'.length + 1)
      const dest = path.join(OUT_NM, rel)
      const r = copyFile(abs, dest)
      if (r === 'ok') stats.ok++
      else {
        stats[r]++
        if (skipped.size < 25) skipped.add(abs.replace(ROOT, '.'))
      }
    }
  }
  console.log('trace copy:', JSON.stringify(stats))
  if (skipped.size) {
    console.log('skipped paths:')
    for (const s of skipped) console.log('  ', s)
  }
  for (const pkg of ['@prisma/client', '.prisma', 'sharp']) {
    const src = path.join(SRC_NM, pkg)
    if (!fs.existsSync(src)) { console.log('WARN: safety-net source missing:', pkg); continue }
    copyDir(src, path.join(OUT_NM, pkg))
    console.log('safety-net full copy:', pkg)
  }
  const nextPkg = path.join(OUT_NM, 'next', 'package.json')
  if (!fs.existsSync(nextPkg)) throw new Error('FATAL: next package missing from trace copy')
  console.log('next version in payload:', JSON.parse(fs.readFileSync(nextPkg, 'utf8')).version)
  const envF = path.join(STANDALONE, '.env')
  if (fs.existsSync(envF)) { fs.rmSync(envF); console.log('removed stray .env from standalone') }
  console.log('payload node_modules size (MB):', duMB(OUT_NM))
}

function listNatives(base) {
  const found = []
  ;(function w(d) {
    let entries
    try { entries = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const p = path.join(d, e.name)
      if (e.isDirectory() && e.name !== '.prisma') w(p)
      else if (e.isDirectory()) w(p)
      else if (/\.(node|so|dll)$/.test(e.name)) found.push(p)
    }
  })(base)
  return found
}

function phaseWinify() {
  const rm = (p) => { if (fs.existsSync(p)) { fs.rmSync(p, { recursive: true, force: true }); console.log('removed', p.replace(OUT_NM, 'node_modules')) } }
  const imgDir = path.join(OUT_NM, '@img')
  if (fs.existsSync(imgDir)) {
    for (const p of fs.readdirSync(imgDir)) if (/linux/i.test(p)) rm(path.join(imgDir, p))
  }
  for (const d of fs.readdirSync(OUT_NM)) {
    if (/^@next/.test(d)) {
      const sub = path.join(OUT_NM, d)
      for (const p of fs.readdirSync(sub)) if (/linux/i.test(p)) rm(path.join(sub, p))
    }
  }
  const prismaDir = path.join(OUT_NM, '.prisma', 'client')
  if (fs.existsSync(prismaDir)) {
    for (const f of fs.readdirSync(prismaDir)) if (/debian|linux|musl|schema-engine/i.test(f)) rm(path.join(prismaDir, f))
  }
  rm(path.join(OUT_NM, '@prisma', 'engines'))

  const sharpWin = path.join(imgDir, 'sharp-win32-x64')
  fs.mkdirSync(imgDir, { recursive: true })
  if (!fs.existsSync(sharpWin)) {
    const tmp = '/tmp/sharp-win32'
    fs.rmSync(tmp, { recursive: true, force: true })
    fs.mkdirSync(tmp, { recursive: true })
    execSync(`cd ${tmp} && npm pack @img/sharp-win32-x64@0.34.5 --silent`, { stdio: 'inherit' })
    const tgz = fs.readdirSync(tmp).find((f) => f.endsWith('.tgz'))
    execSync(`cd ${tmp} && tar -xzf ${tgz}`)
    fs.cpSync(path.join(tmp, 'package'), sharpWin, { recursive: true })
    console.log('installed @img/sharp-win32-x64@0.34.5 into payload')
  }
  const natives = listNatives(OUT_NM)
  console.log('native binaries remaining in payload:', natives.length)
  for (const p of natives) console.log('  ', p.replace(OUT_NM, 'node_modules'))
  const bad = natives.filter((p) => !/windows|win32/i.test(p))
  if (bad.length) {
    console.log('FAIL: non-windows natives still present:')
    for (const p of bad) console.log('  ', p.replace(OUT_NM, 'node_modules'))
    process.exitCode = 1
  } else {
    console.log('OK: only windows natives remain')
  }
  console.log('payload node_modules size (MB):', duMB(OUT_NM))
}

const phase = process.argv[2]
if (phase === 'trace') phaseTrace()
else if (phase === 'winify') phaseWinify()
else { console.error('usage: node scripts/assemble-standalone.js [trace|winify]'); process.exit(1) }
