import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../config-store', () => ({
  configStore: {
    get: vi.fn(() => undefined),
  },
}))

import { runGit, commitChanges, stageHunks, unstageHunks, readGitWorkspaceSnapshot } from '../git-workspace'
import { parseGitDiff } from '../../../packages/shared/diff-model'

const tempDirs: string[] = []

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pi-desktop-git-'))
  tempDirs.push(dir)
  const git = (args: string[]) =>
    execFileSync('git', args, { cwd: dir, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] })
  git(['init', '-q'])
  git(['config', 'user.email', 'test@example.com'])
  git(['config', 'user.name', 'test'])
  git(['config', 'core.autocrlf', 'false'])
  writeFileSync(join(dir, 'a.txt'), 'hello\n')
  git(['add', '.'])
  git(['commit', '-q', '-m', 'init'])
  return dir
}

afterEach(() => {
  for (const d of tempDirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('git-workspace host mode', () => {
  it('runGit resolves branch in a real repo', () => {
    const dir = makeRepo()
    const r = runGit(dir, ['rev-parse', '--abbrev-ref', 'HEAD'], { timeout: 3000 })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.stdout.trim()).toMatch(/^(master|main)$/)
  })

  it('runGit reports not-a-repo for a plain directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pi-desktop-notrepo-'))
    tempDirs.push(dir)
    const r = runGit(dir, ['status'], { timeout: 3000 })
    expect(r).toEqual({ ok: false, notRepo: true, message: '当前目录不是 Git 仓库' })
  })

  it('commitChanges commits via stdin and returns the new hash', () => {
    const dir = makeRepo()
    writeFileSync(join(dir, 'b.txt'), 'new\n')
    execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'ignore' })
    const before = runGit(dir, ['rev-parse', 'HEAD'], { timeout: 3000 })
    const r = commitChanges(dir, 'second commit\n\nwith body')
    expect(r.ok).toBe(true)
    const after = runGit(dir, ['rev-parse', 'HEAD'], { timeout: 3000 })
    expect(r.commitHash).toBeTruthy()
    expect(after.ok && before.ok && after.stdout !== before.stdout).toBe(true)
    if (after.ok) expect(after.stdout.trim()).toBe(r.commitHash)
  })

  it('stageHunks stages a working-tree diff and unstageHunks reverses it', () => {
    const dir = makeRepo()
    writeFileSync(join(dir, 'a.txt'), 'hello\nworld\n')
    const diff = execFileSync('git', ['diff'], { cwd: dir, encoding: 'utf-8' })
    expect(diff).toContain('@@')

    const staged = stageHunks(dir, [{ path: 'a.txt', hunkPatches: [diff] }])
    expect(staged.ok).toBe(true)
    const cached = execFileSync('git', ['diff', '--cached'], { cwd: dir, encoding: 'utf-8' })
    expect(cached).toContain('world')

    const unstaged = unstageHunks(dir, [{ path: 'a.txt', hunkPatches: [diff] }])
    expect(unstaged.ok).toBe(true)
    const cachedAfter = execFileSync('git', ['diff', '--cached'], { cwd: dir, encoding: 'utf-8' })
    expect(cachedAfter).toBe('')
  })

  it('readGitWorkspaceSnapshot returns repo metadata', async () => {
    const dir = makeRepo()
    const snap = await readGitWorkspaceSnapshot(dir)
    expect(snap.isRepo).toBe(true)
    expect(snap.branch).toMatch(/^(master|main)$/)
    expect(typeof snap.raw).toBe('string')
    expect(typeof snap.stagedRaw).toBe('string')
    expect(typeof snap.status).toBe('string')
    expect(snap.log).toContain('init')
  })

  it('readGitWorkspaceSnapshot_keeps_staged_and_untracked_diffs', async () => {
    const dir = makeRepo()
    writeFileSync(join(dir, 'a.txt'), 'hello\nworld\n')
    execFileSync('git', ['add', 'a.txt'], { cwd: dir, stdio: 'ignore' })
    writeFileSync(join(dir, 'extra.txt'), 'fresh\n')
    const snap = await readGitWorkspaceSnapshot(dir)
    expect(snap.stagedRaw).toContain('world')
    expect(snap.status).toContain('extra.txt')
    expect(snap.raw).toContain('fresh')
  })

  it.each(['fresh\n', 'fresh', 'fresh\n\n', '中文\r\n', ''])('stages a new file without changing its bytes (%j)', async (content) => {
    const dir = makeRepo()
    writeFileSync(join(dir, 'new.txt'), content)
    const snap = await readGitWorkspaceSnapshot(dir)
    const file = parseGitDiff(snap.raw).find((entry) => entry.path === 'new.txt')!
    expect(file.hunks).toHaveLength(1)
    expect(stageHunks(dir, [{ path: file.path, hunkPatches: file.hunks.map((hunk) => hunk.patch!) }])).toEqual({ ok: true })
    const staged = execFileSync('git', ['show', ':new.txt'], { cwd: dir })
    expect(staged).toEqual(readFileSync(join(dir, 'new.txt')))
    expect(execFileSync('git', ['diff', '--', 'new.txt'], { cwd: dir, encoding: 'utf-8' })).toBe('')
  })

  it.each([
    ['old', 'new'],
    ['old\n', 'new'],
    ['old', 'new\n'],
  ])('stages and unstages an EOF change from %j to %j', (before, after) => {
    const dir = makeRepo()
    writeFileSync(join(dir, 'a.txt'), before)
    execFileSync('git', ['add', '--', 'a.txt'], { cwd: dir })
    writeFileSync(join(dir, 'a.txt'), after)
    const raw = execFileSync('git', ['diff', '--', 'a.txt'], { cwd: dir, encoding: 'utf-8' })
    const file = parseGitDiff(raw)[0]
    expect(stageHunks(dir, [{ path: file.path, hunkPatches: file.hunks.map((hunk) => hunk.patch!) }])).toEqual({ ok: true })
    expect(execFileSync('git', ['show', ':a.txt'], { cwd: dir, encoding: 'utf-8' })).toBe(after)
    expect(unstageHunks(dir, [{ path: file.path, hunkPatches: file.hunks.map((hunk) => hunk.patch!) }])).toEqual({ ok: true })
    expect(execFileSync('git', ['show', ':a.txt'], { cwd: dir, encoding: 'utf-8' })).toBe(before)
    expect(readFileSync(join(dir, 'a.txt'), 'utf-8')).toBe(after)
  })
})
