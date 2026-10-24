$ErrorActionPreference = 'Stop'

$workspace = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$indexPath = Join-Path $workspace 'FILE_INDEX.md'
$generatedAt = Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz'

$files = @(Get-ChildItem -LiteralPath $workspace -Recurse -File -Force -ErrorAction SilentlyContinue | Where-Object {
    $_.FullName -ne $indexPath -and
    $_.FullName -notmatch '(\\|/)\.git(\\|/|$)' -and
    $_.FullName -notmatch '(\\|/)(node_modules|\.superpowers|\.next|dist|coverage)(\\|/|$)'
})

$records = @(
    foreach ($file in $files) {
        $relative = $file.FullName.Substring($workspace.Length + 1).Replace('\', '/')
        [pscustomobject]@{
            Path = $relative
            Bytes = [int64]$file.Length
            Extension = if ([string]::IsNullOrWhiteSpace($file.Extension)) { '(none)' } else { $file.Extension.ToLowerInvariant() }
            LastWrite = $file.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss')
        }
    }
) | Sort-Object Path

$directories = @(Get-ChildItem -LiteralPath $workspace -Recurse -Directory -Force -ErrorAction SilentlyContinue | Where-Object {
    $_.FullName -notmatch '(\\|/)\.git(\\|/|$)' -and
    $_.FullName -notmatch '(\\|/)(node_modules|\.superpowers|\.next|dist|coverage)(\\|/|$)'
})

$fileCountsByDirectory = @{}
foreach ($record in $records) {
    $parts = $record.Path -split '/'
    for ($index = 1; $index -lt $parts.Count; $index++) {
        $directoryPath = ($parts[0..($index - 1)] -join '/')
        if ($fileCountsByDirectory.ContainsKey($directoryPath)) {
            $fileCountsByDirectory[$directoryPath]++
        } else {
            $fileCountsByDirectory[$directoryPath] = 1
        }
    }
}

$directoryRecords = @(
    foreach ($directory in $directories) {
        $relative = $directory.FullName.Substring($workspace.Length + 1).Replace('\', '/')
        [pscustomobject]@{
            Path = $relative
            Files = if ($fileCountsByDirectory.ContainsKey($relative)) { $fileCountsByDirectory[$relative] } else { 0 }
        }
    }
) | Sort-Object Path

$topGroups = @(
    foreach ($group in ($records | Group-Object {
        if ($_.Path -match '/') { ($_.Path -split '/')[0] } else { '(root)' }
    } | Sort-Object Name)) {
        [pscustomobject]@{
            Name = $group.Name
            Files = $group.Count
            Bytes = [int64](($group.Group | Measure-Object -Property Bytes -Sum).Sum)
        }
    }
)

$totalBytes = [int64](($records | Measure-Object -Property Bytes -Sum).Sum)
$lines = [System.Collections.Generic.List[string]]::new()
$lines.Add('# FILE_INDEX.md')
$lines.Add('')
$lines.Add('本文件是 `F:\PlaneMem` 工作区的文件索引。它用于让需求、设计、实现、测试、发布和供应商源码能够按统一路径被定位。')
$lines.Add('')
$lines.Add('## 维护规则')
$lines.Add('')
$lines.Add('- 新增、删除、移动或重命名文件时，必须在同一次变更中更新本文件。')
$lines.Add('- 从工作区根目录执行 `powershell -ExecutionPolicy Bypass -File tools/update-file-index.ps1` 重新生成索引。')
$lines.Add('- 更新时重新扫描 `F:\PlaneMem`，保持路径使用 `/` 分隔，并同步文件大小、扩展名和目录统计。')
$lines.Add('- 本索引不把自身纳入扫描统计；`.git`、`node_modules`、`.superpowers`、`.next`、`dist`、`coverage` 等内部或生成目录不纳入项目文件索引。')
$lines.Add('- 完成变更后检查本文件的文件总数、目录总数和 `git diff`，确保索引与工作区实际状态一致。')
$lines.Add('')
$lines.Add('## 生成信息')
$lines.Add('')
$lines.Add('- 工作区：`F:\PlaneMem`')
$lines.Add(('- 生成时间：`' + $generatedAt + '`'))
$lines.Add(('- 文件总数（不含本索引与版本控制内部文件）：`' + $records.Count + '`'))
$lines.Add(('- 目录总数（不含版本控制内部目录）：`' + $directoryRecords.Count + '`'))
$lines.Add(('- 总字节数（不含本索引与版本控制内部文件）：`' + $totalBytes + '`'))
$lines.Add('')
$lines.Add('## 顶层目录统计')
$lines.Add('')
$lines.Add('| 顶层路径 | 文件数 | 字节数 |')
$lines.Add('|---|---:|---:|')
foreach ($group in $topGroups) {
    $lines.Add('| `' + $group.Name + '` | ' + $group.Files + ' | ' + $group.Bytes + ' |')
}
$lines.Add('')
$lines.Add('## 目录清单')
$lines.Add('')
$lines.Add('目录路径均相对于 `F:\PlaneMem`，文件数包含该目录及其所有子目录中的文件。')
$lines.Add('')
foreach ($directory in $directoryRecords) {
    $lines.Add('- `' + $directory.Path + '/` — ' + $directory.Files + ' files')
}
$lines.Add('')
$lines.Add('## 索引文件')
$lines.Add('')
$lines.Add('- [`FILE_INDEX.md`](FILE_INDEX.md) — 本索引文件；文件增删改名后必须同步更新。')
$lines.Add('')
$lines.Add('## 全量文件清单')
$lines.Add('')
$lines.Add('路径均相对于 `F:\PlaneMem`，每一项包含文件大小、扩展名和最后修改时间。供应商源码 `codes/ai-memory` 也纳入索引；生成依赖与运行产物目录按维护规则排除。')
$lines.Add('')

foreach ($group in ($records | Group-Object { ($_.Path -split '/')[0] } | Sort-Object Name)) {
    $sectionName = $group.Name
    if ($sectionName -eq 'docs') { $sectionName = 'docs — 项目文档与设计' }
    elseif ($sectionName -eq 'codes') { $sectionName = 'codes — 外部源码与适配参考' }
    elseif ($sectionName -eq 'tools') { $sectionName = 'tools — 可重复执行的维护脚本' }
    elseif ($sectionName -eq 'ReadMe.md') { $sectionName = 'ReadMe.md — 根目录说明' }
    $lines.Add('### ' + $sectionName)
    $lines.Add('')
    foreach ($record in ($group.Group | Sort-Object Path)) {
        $label = $record.Path.Replace('[', '\[').Replace(']', '\]')
        $linkPath = $record.Path.Replace('(', '\(').Replace(')', '\)')
        $lines.Add('- [' + $label + '](' + $linkPath + ') — ' + $record.Bytes + ' bytes; ' + $record.Extension + '; 修改于 ' + $record.LastWrite)
    }
    $lines.Add('')
}

Set-Content -LiteralPath $indexPath -Value $lines -Encoding utf8
Write-Output ('Updated ' + $indexPath)
Write-Output ('Indexed files: ' + $records.Count)
Write-Output ('Indexed directories: ' + $directoryRecords.Count)
