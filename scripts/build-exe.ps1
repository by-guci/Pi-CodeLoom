#Requires -Version 5.1
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$projectRoot = Split-Path -Parent $PSScriptRoot
$buildExitCode = 0
Push-Location -LiteralPath $projectRoot

try {
    Write-Host '[1/5] 检查 Node.js 和依赖...' -ForegroundColor Cyan
    $nodePath = (Get-Command node.exe -ErrorAction Stop).Source
    $npmPath = (Get-Command npm.cmd -ErrorAction Stop).Source
    $nodeVersion = (& $nodePath --version).Trim().TrimStart('v').Split('-')[0]
    if ($LASTEXITCODE -ne 0 -or [version]$nodeVersion -lt [version]'22.19.0') {
        throw '请安装 Node.js 22.19.0 或更高版本，然后重新运行脚本。'
    }

    function Invoke-NpmStep([string[]]$Arguments) {
        & $npmPath @Arguments
        if ($LASTEXITCODE -ne 0) {
            throw "npm $($Arguments -join ' ') 执行失败，退出码：$LASTEXITCODE"
        }
    }

    $builderPath = Join-Path $projectRoot 'node_modules\.bin\electron-builder.cmd'
    $vitePath = Join-Path $projectRoot 'node_modules\.bin\electron-vite.cmd'
    if (!(Test-Path -LiteralPath $builderPath) -or !(Test-Path -LiteralPath $vitePath)) {
        Write-Host '首次运行，正在安装 package-lock.json 中的依赖...'
        Invoke-NpmStep @('ci')
    }

    Write-Host '[2/5] 检查 TypeScript 类型...' -ForegroundColor Cyan
    Invoke-NpmStep @('run', 'typecheck')

    Write-Host '[3/5] 生成应用图标...' -ForegroundColor Cyan
    Invoke-NpmStep @('run', 'icon:export')

    Write-Host '[4/5] 构建应用源码...' -ForegroundColor Cyan
    Invoke-NpmStep @('run', 'build')

    Write-Host '[5/5] 生成 Windows x64 安装包...' -ForegroundColor Cyan
    & $builderPath --win nsis --x64 --publish never
    if ($LASTEXITCODE -ne 0) {
        throw "安装包生成失败，退出码：$LASTEXITCODE"
    }

    $manifest = Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json
    $installerPath = Join-Path $projectRoot "dist\Pi-CodeLoom-Setup-$($manifest.version)-x64.exe"
    $metadataPath = Join-Path $projectRoot 'dist\latest.yml'
    foreach ($artifactPath in @($installerPath, "$installerPath.blockmap", $metadataPath)) {
        if (!(Test-Path -LiteralPath $artifactPath -PathType Leaf) -or (Get-Item -LiteralPath $artifactPath).Length -eq 0) {
            throw "未生成预期的打包文件：$artifactPath"
        }
    }

    Write-Host "`n打包完成！" -ForegroundColor Green
    Write-Host "安装包：$installerPath"
    Write-Host "更新文件：$metadataPath"
    Write-Host "差分文件：$installerPath.blockmap"
    Write-Host '本脚本仅在本地打包，不会上传到 GitHub 或安装应用。'
}
catch {
    $buildExitCode = 1
    Write-Host "`n打包失败：$($_.Exception.Message)" -ForegroundColor Red
    Write-Host '请检查上方报错；若缺少 Node.js，请安装后重新打开终端。'
}
finally {
    Pop-Location
}

exit $buildExitCode
