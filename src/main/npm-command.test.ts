import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveNpmCommand } from './npm-command'

let directory: string

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'pi-npm-command-'))
})

afterEach(() => {
  rmSync(directory, { recursive: true, force: true })
})

function npmDirectory(name: string): string {
  const bin = join(directory, name)
  mkdirSync(join(bin, 'node_modules', 'npm', 'bin'), { recursive: true })
  writeFileSync(join(bin, 'npm.cmd'), '@echo off')
  writeFileSync(join(bin, 'node_modules', 'npm', 'bin', 'npm-cli.js'), '')
  return bin
}

describe('resolveNpmCommand', () => {
  it('launches the npm CLI with Node instead of trying to execute npm.cmd on Windows', () => {
    const bin = npmDirectory('node with spaces & symbols')
    writeFileSync(join(bin, 'node.exe'), '')

    expect(resolveNpmCommand({ platform: 'win32', env: { Path: bin } })).toEqual({
      command: join(bin, 'node.exe'),
      args: [join(bin, 'node_modules', 'npm', 'bin', 'npm-cli.js')],
    })
  })

  it('uses PATH Node when a separately installed npm has no adjacent node.exe', () => {
    const npmBin = npmDirectory('npm-global')
    const nodeBin = join(directory, 'node-runtime')
    mkdirSync(nodeBin)
    writeFileSync(join(nodeBin, 'node.exe'), '')

    expect(resolveNpmCommand({ platform: 'win32', env: { PATH: `${npmBin};${nodeBin}` } })).toEqual({
      command: join(nodeBin, 'node.exe'),
      args: [join(npmBin, 'node_modules', 'npm', 'bin', 'npm-cli.js')],
    })
  })

  it('supports executable npm shims without invoking a shell', () => {
    writeFileSync(join(directory, 'npm.exe'), '')
    expect(resolveNpmCommand({ platform: 'win32', env: { PATH: directory } })).toEqual({
      command: join(directory, 'npm.exe'), args: [],
    })
  })

  it('reports a missing Windows npm installation instead of trying a broken command', () => {
    expect(() => resolveNpmCommand({ platform: 'win32', env: { PATH: directory } })).toThrow(/npm/)
  })

  it('keeps the normal executable npm command on Unix', () => {
    expect(resolveNpmCommand({ platform: 'linux', env: {} })).toEqual({ command: 'npm', args: [] })
  })
})
