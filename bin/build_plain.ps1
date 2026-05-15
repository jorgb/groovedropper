$ErrorActionPreference = 'Stop'

$BinDir    = Split-Path -Parent $MyInvocation.MyCommand.Path
$ScriptDir = Split-Path -Parent $BinDir

# ── Phase 1: sanity checks ────────────────────────────────────────────────────

if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: python not found on PATH." -ForegroundColor Red
    exit 1
}

$VersionFile = Join-Path $ScriptDir 'VERSION'
if (-not (Test-Path $VersionFile)) {
    Write-Host "ERROR: VERSION file not found at $VersionFile" -ForegroundColor Red
    exit 1
}
$Version = (Get-Content $VersionFile -Raw).Trim()
if (-not $Version) {
    Write-Host "ERROR: VERSION file is empty." -ForegroundColor Red
    exit 1
}

$AppName  = "GrooveDropper-$Version"
$ZipOut   = Join-Path $ScriptDir "$AppName.zip"

Write-Host "=== GrooveDropper Plain Source Package ===" -ForegroundColor Cyan
Write-Host "Version : $Version"
Write-Host "Output  : $ZipOut"

# ── Phase 2: staging directory ────────────────────────────────────────────────

$StageRoot = Join-Path $env:TEMP 'GrooveDropper-stage'
$StageDir  = Join-Path $StageRoot $AppName

if (Test-Path $StageRoot) {
    Remove-Item $StageRoot -Recurse -Force
}
New-Item -ItemType Directory -Path $StageDir -Force | Out-Null
Write-Host "`n[1/4] Staging to $StageDir" -ForegroundColor Yellow

# ── Phase 3: copy inclusions ──────────────────────────────────────────────────

function Copy-Item-Mkdir ($Src, $Dst) {
    $DstDir = Split-Path -Parent $Dst
    if (-not (Test-Path $DstDir)) {
        New-Item -ItemType Directory -Path $DstDir -Force | Out-Null
    }
    Copy-Item -Path $Src -Destination $Dst -Force
}

function Copy-Dir-Filtered ($Src, $Dst) {
    Get-ChildItem -Path $Src -Recurse -File | Where-Object {
        $_.FullName -notmatch '\\__pycache__\\' -and
        $_.Extension -ne '.pyc'
    } | ForEach-Object {
        $Rel = $_.FullName.Substring($Src.Length).TrimStart('\')
        $Target = Join-Path $Dst $Rel
        Copy-Item-Mkdir $_.FullName $Target
    }
}

# Root files
foreach ($f in @('app.py', 'app_gui.py', 'requirements.txt')) {
    $Src = Join-Path $ScriptDir $f
    if (Test-Path $Src) {
        Copy-Item $Src (Join-Path $StageDir $f) -Force
    } else {
        Write-Host "  WARNING: $f not found, skipping." -ForegroundColor DarkYellow
    }
}

# Python package and web assets
foreach ($d in @('groove', 'static', 'templates')) {
    $Src = Join-Path $ScriptDir $d
    if (Test-Path $Src) {
        Copy-Dir-Filtered $Src (Join-Path $StageDir $d)
    } else {
        Write-Host "  WARNING: $d/ not found, skipping." -ForegroundColor DarkYellow
    }
}

# bin/ run scripts (exclude build scripts and this script itself)
$BinDst = Join-Path $StageDir 'bin'
$BinIncludes = @(
    'run.bat', 'run.ps1',
    'run_gui.bat', 'run_gui.ps1',
    'run.sh', 'run_gui.sh',
    'GrooveDropper.desktop', 'groovedropper_icon.png'
)
foreach ($f in $BinIncludes) {
    $Src = Join-Path $BinDir $f
    if (Test-Path $Src) {
        Copy-Item-Mkdir $Src (Join-Path $BinDst $f)
    }
}

# docs/images/ (all images, used by MANUAL)
$DocsImgSrc = Join-Path $ScriptDir 'docs\images'
if (Test-Path $DocsImgSrc) {
    $DocsImgDst = Join-Path $StageDir 'docs\images'
    Get-ChildItem -Path $DocsImgSrc -File | ForEach-Object {
        Copy-Item-Mkdir $_.FullName (Join-Path $DocsImgDst $_.Name)
    }
}

# ── Phase 4: media reference scan ─────────────────────────────────────────────

Write-Host "`n[2/4] Scanning README and MANUAL for media references..." -ForegroundColor Yellow

$MediaRefs = [System.Collections.Generic.HashSet[string]]::new()
$ScanPattern = '!\[.*?\]\((media/[^\)]+)\)'

foreach ($DocFile in @('README.md', 'docs\MANUAL.md')) {
    $DocPath = Join-Path $ScriptDir $DocFile
    if (Test-Path $DocPath) {
        $Content = Get-Content $DocPath -Raw
        [regex]::Matches($Content, $ScanPattern) | ForEach-Object {
            $MediaRefs.Add($_.Groups[1].Value) | Out-Null
        }
    }
}

Write-Host "  Media files referenced: $($MediaRefs.Count)"
$MediaDst = Join-Path $StageDir 'media'
foreach ($Ref in $MediaRefs) {
    $Src = Join-Path $ScriptDir $Ref.Replace('/', '\')
    if (Test-Path $Src) {
        $FileName = Split-Path -Leaf $Src
        Copy-Item-Mkdir $Src (Join-Path $MediaDst $FileName)
        Write-Host "  + $Ref"
    } else {
        Write-Host "  WARNING: referenced media not found: $Ref" -ForegroundColor DarkYellow
    }
}

# ── Phase 5: HTML conversion ──────────────────────────────────────────────────

Write-Host "`n[3/4] Converting Markdown to HTML..." -ForegroundColor Yellow

$PyScript = Join-Path $env:TEMP 'gd_md2html.py'

@'
import sys, subprocess, importlib

def ensure_markdown():
    try:
        import markdown
        return True
    except ImportError:
        subprocess.check_call([sys.executable, '-m', 'pip', 'install', 'markdown', '--quiet'])
        importlib.invalidate_caches()
        try:
            import markdown
            return True
        except ImportError:
            return False

CSS = """
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
     max-width:820px;margin:40px auto;padding:0 20px;
     line-height:1.6;color:#222}
h1,h2,h3{border-bottom:1px solid #ddd;padding-bottom:.3em}
code{background:#f4f4f4;padding:.15em .35em;border-radius:3px;font-size:.9em}
pre{background:#f4f4f4;padding:1em;border-radius:4px;overflow-x:auto}
pre code{background:none;padding:0}
table{border-collapse:collapse;width:100%}
th,td{border:1px solid #ccc;padding:.5em .8em;text-align:left}
th{background:#f0f0f0}
img{max-width:100%;height:auto}
a{color:#0066cc}
blockquote{border-left:4px solid #ccc;margin:0;padding-left:1em;color:#555}
"""

def convert(src, dst, title):
    import markdown
    with open(src, encoding='utf-8') as f:
        text = f.read()
    body = markdown.markdown(text, extensions=['tables', 'fenced_code'])
    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title}</title>
<style>{CSS}</style>
</head>
<body>
{body}
</body>
</html>"""
    import os
    os.makedirs(os.path.dirname(dst) or '.', exist_ok=True)
    with open(dst, 'w', encoding='utf-8') as f:
        f.write(html)
    print(f"  -> {dst}")

if not ensure_markdown():
    print("WARNING: could not install markdown package, skipping HTML conversion.", file=sys.stderr)
    sys.exit(1)

src, dst, title = sys.argv[1], sys.argv[2], sys.argv[3]
convert(src, dst, title)
'@ | Set-Content $PyScript -Encoding UTF8

$HtmlOk = $true
$Conversions = @(
    @{ Src = 'README.md';      Dst = 'README.html';      Title = 'GrooveDropper' },
    @{ Src = 'docs\MANUAL.md'; Dst = 'docs\MANUAL.html'; Title = 'GrooveDropper — User Manual' }
)

foreach ($C in $Conversions) {
    $Src   = Join-Path $ScriptDir $C.Src
    $Dst   = Join-Path $StageDir  $C.Dst
    if (-not (Test-Path $Src)) {
        Write-Host "  WARNING: $($C.Src) not found, skipping." -ForegroundColor DarkYellow
        continue
    }
    python $PyScript $Src $Dst $C.Title
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  WARNING: HTML conversion failed for $($C.Src), continuing." -ForegroundColor DarkYellow
        $HtmlOk = $false
    }
}

Remove-Item $PyScript -Force -ErrorAction SilentlyContinue

if (-not $HtmlOk) {
    Write-Host "  (some HTML files were skipped)" -ForegroundColor DarkYellow
}

# ── Phase 6: zip and cleanup ──────────────────────────────────────────────────

Write-Host "`n[4/4] Compressing..." -ForegroundColor Yellow

if (Test-Path $ZipOut) { Remove-Item $ZipOut -Force }
Compress-Archive -Path "$StageDir\*" -DestinationPath $ZipOut

Remove-Item $StageRoot -Recurse -Force

$ZipSize = [math]::Round((Get-Item $ZipOut).Length / 1MB, 2)

Write-Host "`n=== Done ===" -ForegroundColor Green
Write-Host "Archive : $ZipOut ($ZipSize MB)" -ForegroundColor Cyan