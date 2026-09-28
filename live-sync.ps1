# =====================================================================
#  SEBN TN3 - Rework Live Sync
#
#  Pont entre le site rework interne et le tableau de bord en ligne.
#
#  Ce script LIT les pages du site rework (comme un navigateur) et les
#  ENVOIE au serveur du tableau de bord. Il ne modifie jamais le site.
#
#  Rien a installer : PowerShell est deja present sur tout PC Windows.
#  Laissez la fenetre ouverte : elle se met a jour toutes les 60 secondes.
#
#  Pour arreter : fermez la fenetre, ou appuyez sur Ctrl+C.
# =====================================================================

# ---------------------------------------------------------------------
#  CONFIGURATION
# ---------------------------------------------------------------------
$Base        = 'http://rework.jenapp0001.sebn.com'
$CloudUrl    = 'https://ksk-scraper-production.up.railway.app'
# La cle n'est JAMAIS ecrite dans ce script ni dans le .bat. Au premier
# lancement elle est demandee une fois, puis enregistree chiffree (DPAPI
# Windows) dans live-sync.key : lisible uniquement par ce compte Windows sur
# ce PC. Supprimer ce fichier fait redemander la cle.
$KeyFile     = Join-Path $PSScriptRoot 'live-sync.key'
# Arret automatique apres ce nombre de refus d'affilee du serveur : c'est ce
# qui se passe quand l'administrateur revoque la cle.
$MaxConsecutiveRejections = 3

$IntervalSeconds   = 60      # pause entre deux cycles
$Models            = @('MAM', 'MCM')
$DetailDelayMs     = 150     # pause entre deux fiches (politesse envers le serveur)
$MaxDetailsPerCycle = 150    # fiches par cycle en rythme normal
# Au premier demarrage il y a ~6000 fiches a recuperer. On accelere tant que
# le retard est important, puis on revient au rythme normal.
$BacklogThreshold  = 500
$BacklogDelayMs    = 60
$BacklogPerCycle   = 400
$DetailBatchSize   = 50      # fiches par envoi

# Les variables d'environnement permettent de tester sans modifier le script.
if ($env:REWORK_BASE)  { $Base = $env:REWORK_BASE }
if ($env:CLOUD_URL)    { $CloudUrl = $env:CLOUD_URL }
if ($env:SYNC_INTERVAL){ $IntervalSeconds = [int]$env:SYNC_INTERVAL }
if ($env:SYNC_CYCLES)  { $MaxCycles = [int]$env:SYNC_CYCLES } else { $MaxCycles = 0 }

$IngestUrl   = "$CloudUrl/api/scraper/ingest"
$AgentName   = "$env:COMPUTERNAME"
$LogFile     = Join-Path $PSScriptRoot 'live-sync.log'
$UserAgent   = 'SEBN-ReworkDashboard-Agent/1.0'

# TLS 1.2 : les anciens PowerShell ne l'activent pas par defaut et l'envoi
# HTTPS echouerait sans explication.
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch { }

$script:UseGzip = $true
$script:Session = $null
$script:SyncKey = $null
$script:Rejections = 0

function Write-Log {
  param([string]$Message, [string]$Color = 'Gray')
  $line = "[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $Message
  Write-Host $line -ForegroundColor $Color
  try { Add-Content -Path $LogFile -Value $line -Encoding UTF8 } catch { }
}

# --- Cle de signature ------------------------------------------------
# SYNC_SECRET (variable d'environnement) sert uniquement aux tests
# automatises. En production la cle vit dans live-sync.key, chiffree par
# Windows pour ce compte et ce PC (DPAPI) : copier le fichier ailleurs ne
# permet pas de la lire.
function Get-SyncKey {
  if ($env:SYNC_SECRET) { return $env:SYNC_SECRET }

  if (Test-Path $KeyFile) {
    try {
      $secure = Get-Content -Path $KeyFile -Raw | ConvertTo-SecureString
      $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
      try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
      finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
    }
    catch {
      Write-Log "La cle enregistree n'est pas lisible sur ce compte Windows : elle va etre redemandee." 'Yellow'
      Remove-Item -Path $KeyFile -Force -ErrorAction SilentlyContinue
    }
  }

  Write-Host ""
  Write-Host "  Premiere utilisation sur ce PC." -ForegroundColor Cyan
  Write-Host "  Collez la cle fournie par l'administrateur (elle ne s'affiche pas)." -ForegroundColor Cyan
  $secure = Read-Host -AsSecureString "  Cle"
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }

  if (-not $plain -or $plain.Trim().Length -lt 32) {
    throw "Cle invalide (32 caracteres minimum). Relancez live-sync.bat et collez la cle complete."
  }
  $secure | ConvertFrom-SecureString | Set-Content -Path $KeyFile -Encoding ASCII
  Write-Log "Cle enregistree (chiffree) dans live-sync.key." 'Green'
  return $plain.Trim()
}

# --- Signature HMAC-SHA256 --------------------------------------------
# La cle ne voyage jamais. Chaque envoi porte l'heure, un nombre unique et
# HMAC(cle, heure.nombre.corps) : un envoi intercepte ne peut ni etre
# modifie, ni etre rejoue (le serveur refuse au-dela de 5 minutes et
# refuse un nombre deja vu).
function New-Signature {
  param([byte[]]$Body, [string]$Timestamp, [string]$Nonce)
  $hmac = New-Object System.Security.Cryptography.HMACSHA256 (, [Text.Encoding]::UTF8.GetBytes($script:SyncKey))
  try {
    $prefix = [Text.Encoding]::ASCII.GetBytes("$Timestamp.$Nonce.")
    $data = New-Object byte[] ($prefix.Length + $Body.Length)
    [Buffer]::BlockCopy($prefix, 0, $data, 0, $prefix.Length)
    [Buffer]::BlockCopy($Body, 0, $data, $prefix.Length, $Body.Length)
    return ([BitConverter]::ToString($hmac.ComputeHash($data)) -replace '-', '').ToLowerInvariant()
  }
  finally { $hmac.Dispose() }
}

function Get-HttpStatus {
  param($ErrorRecord)
  try { return [int]$ErrorRecord.Exception.Response.StatusCode } catch { return 0 }
}

# Un refus du serveur a deux causes possibles : cle revoquee, ou horloge du
# PC decalee (la signature n'est valable que 5 minutes). Le serveur ne dit
# pas laquelle ; l'en-tete Date de sa reponse permet de trancher la seconde.
function Write-ClockHint {
  param($ErrorRecord)
  try {
    $serverDate = [DateTimeOffset]::Parse($ErrorRecord.Exception.Response.Headers['Date'])
    $skew = [Math]::Abs(([DateTimeOffset]::UtcNow - $serverDate).TotalMinutes)
    if ($skew -gt 4) {
      Write-Log ("L'horloge de ce PC est decalee de {0:N0} minutes : reglez la date et l'heure de Windows." -f $skew) 'Yellow'
    }
  } catch { }
}

# --- Session sur le site rework --------------------------------------
# Le POST de recherche est refuse sans cookie : on passe par main.php.
function Connect-Rework {
  $null = Invoke-WebRequest -Uri "$Base/main.php" -SessionVariable s `
                            -UseBasicParsing -TimeoutSec 30 -UserAgent $UserAgent
  $script:Session = $s
  Write-Log "Session etablie sur $Base" 'DarkGray'
}

# --- Envoi vers le tableau de bord -----------------------------------
# Le corps est du JSON construit a la main : le base64 ne contient aucun
# caractere a echapper, et ConvertTo-Json sur 1 Mo est tres lent.
function Send-Json {
  param([string]$Url, [string]$Json)

  # Signe sur les octets non compresses : le serveur verifie apres
  # decompression, avant de lire le moindre champ.
  $bytes = [Text.Encoding]::UTF8.GetBytes($Json)
  $timestamp = [string][DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
  $nonce = [Guid]::NewGuid().ToString('N')
  $headers = @{
    'x-sync-timestamp' = $timestamp
    'x-sync-nonce'     = $nonce
    'x-sync-signature' = (New-Signature -Body $bytes -Timestamp $timestamp -Nonce $nonce)
  }

  if ($script:UseGzip) {
    try {
      $ms = New-Object System.IO.MemoryStream
      $gz = New-Object System.IO.Compression.GZipStream($ms, [IO.Compression.CompressionMode]::Compress)
      $gz.Write($bytes, 0, $bytes.Length)
      $gz.Close()
      $payload = $ms.ToArray()
      $ms.Dispose()
      $headers['Content-Encoding'] = 'gzip'
      return Invoke-RestMethod -Uri $Url -Method POST -Body $payload `
                               -ContentType 'application/json' -Headers $headers `
                               -TimeoutSec 120 -UserAgent $UserAgent
    }
    catch {
      # Seul un proxy qui refuse les corps compresses (400/415) justifie de
      # repasser en envoi normal. Un refus d'authentification, lui, remonte.
      $status = Get-HttpStatus $_
      if ($status -ne 400 -and $status -ne 415) { throw }
      Write-Log "Envoi compresse refuse par le reseau - passage en envoi normal." 'Yellow'
      $script:UseGzip = $false
      # Nouveau nombre unique : le precedent a pu etre enregistre par le serveur.
      return Send-Json -Url $Url -Json $Json
    }
  }

  return Invoke-RestMethod -Uri $Url -Method POST -Body $bytes `
                           -ContentType 'application/json' -Headers $headers `
                           -TimeoutSec 120 -UserAgent $UserAgent
}

function Get-PageBase64 {
  param([string]$Url, [switch]$UseSession)

  if ($UseSession) {
    $resp = Invoke-WebRequest -Uri $Url -WebSession $script:Session -UseBasicParsing `
                              -TimeoutSec 120 -UserAgent $UserAgent
  } else {
    $resp = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 60 -UserAgent $UserAgent
  }
  # Les octets bruts, pas le texte : le site n'annonce aucun encodage et le
  # serveur le detecte lui-meme. Laisser PowerShell decoder casserait les
  # accents (un commentaire sur trois en contient).
  return [Convert]::ToBase64String($resp.RawContentStream.ToArray())
}

function Send-ListPage {
  param([string]$Model)

  $body = "numer=&model=$Model&kenn=&rej1=&rej2=&komentar=&kolor="
  $resp = Invoke-WebRequest -Uri "$Base/Szczegol.php?AK=1" -Method POST -Body $body `
                            -ContentType 'application/x-www-form-urlencoded' `
                            -WebSession $script:Session -UseBasicParsing `
                            -TimeoutSec 120 -UserAgent $UserAgent

  $b64 = [Convert]::ToBase64String($resp.RawContentStream.ToArray())
  $contentType = $resp.Headers['Content-Type']
  if (-not $contentType) { $contentType = '' }

  $json = '{"model":"' + $Model + '","agent":"' + $AgentName + '","contentType":"' + $contentType + '","listBase64":"' + $b64 + '"}'
  return Send-Json -Url $IngestUrl -Json $json
}

function Send-DetailPages {
  param([string]$Model, [string[]]$Numbers, [int]$Pending)

  # Le serveur ne donne qu'un lot a la fois (250) mais indique combien de
  # fiches restent au total. Au premier demarrage il y en a ~6000 : on
  # accelere et on enchaine les lots jusqu'a epuiser le budget du cycle.
  $delay = $DetailDelayMs
  $budget = $MaxDetailsPerCycle
  if ($Pending -ge $BacklogThreshold) {
    $delay = $BacklogDelayMs
    $budget = $BacklogPerCycle
    Write-Log "  $Model : rattrapage de l'historique ($Pending fiches en attente)" 'Yellow'
  }

  $queue = New-Object System.Collections.Generic.Queue[string]
  foreach ($no in $Numbers) { $queue.Enqueue($no) }

  $seen = New-Object System.Collections.Generic.HashSet[string]
  $sent = 0
  $applied = 0
  $remaining = $Pending
  $batch = New-Object System.Collections.Generic.List[string]

  function Push-Batch {
    param([System.Collections.Generic.List[string]]$Pages)
    return Send-Json -Url "$IngestUrl/details" `
                     -Json ('{"model":"' + $Model + '","agent":"' + $AgentName + '","pages":[' + ($Pages -join ',') + ']}')
  }

  while ($queue.Count -gt 0 -and $sent -lt $budget) {
    $no = $queue.Dequeue()
    if (-not $seen.Add($no)) { continue }

    try {
      $b64 = Get-PageBase64 -Url "$Base/Szczegol.php?numer=$no&model=$Model"
      $batch.Add('{"no":"' + $no + '","base64":"' + $b64 + '"}')
    }
    catch {
      Write-Log "  fiche $Model #$no illisible : $($_.Exception.Message)" 'DarkYellow'
    }

    if ($batch.Count -ge $DetailBatchSize) {
      $result = Push-Batch -Pages $batch
      $sent += $batch.Count
      $applied += [int]$result.applied
      $remaining = [int]$result.pending
      $batch.Clear()
      Write-Log "  $Model : $sent envoyees, $remaining en attente" 'DarkGray'

      # Le serveur renvoie le lot suivant : on continue sans attendre le
      # prochain cycle tant que le budget le permet.
      if ($result.needDetails) {
        foreach ($next in @($result.needDetails)) {
          if (-not $seen.Contains($next)) { $queue.Enqueue($next) }
        }
      }
    }

    Start-Sleep -Milliseconds $delay
  }

  if ($batch.Count -gt 0) {
    $result = Push-Batch -Pages $batch
    $sent += $batch.Count
    $applied += [int]$result.applied
    $remaining = [int]$result.pending
  }

  return @{ Sent = $sent; Applied = $applied; Remaining = $remaining }
}

# ---------------------------------------------------------------------
#  BOUCLE PRINCIPALE
# ---------------------------------------------------------------------
Write-Host ""
Write-Host "  ============================================" -ForegroundColor Cyan
Write-Host "   SEBN TN3 - Rework Live Sync" -ForegroundColor Cyan
Write-Host "  ============================================" -ForegroundColor Cyan
Write-Host "   Site rework   : $Base" -ForegroundColor Gray
Write-Host "   Tableau bord  : $CloudUrl" -ForegroundColor Gray
Write-Host "   Poste         : $AgentName" -ForegroundColor Gray
Write-Host "   Cycle         : toutes les $IntervalSeconds secondes" -ForegroundColor Gray
Write-Host ""
Write-Host "   Laissez cette fenetre ouverte pendant la demonstration." -ForegroundColor Yellow
Write-Host "   Pour arreter : Ctrl+C ou fermez la fenetre." -ForegroundColor Yellow
Write-Host ""

try { $script:SyncKey = Get-SyncKey }
catch {
  Write-Log $_.Exception.Message 'Red'
  exit 1
}

$cycle = 0
while ($true) {
  $cycle++
  try {
    if (-not $script:Session) { Connect-Rework }

    foreach ($model in $Models) {
      Write-Log "Lecture du site rework ($model)..." 'Cyan'
      $listResult = Send-ListPage -Model $model

      if ([int]$listResult.rowsOnPage -eq 0) {
        # Page de connexion ou session expiree : on repart proprement.
        Write-Log "$model : aucune ligne lue - reconnexion au prochain cycle." 'Yellow'
        $script:Session = $null
        continue
      }

      $needed = @()
      if ($listResult.needDetails) { $needed = @($listResult.needDetails) }
      $pending = [int]$listResult.pending
      Write-Log ("Envoye au tableau de bord : {0} OK ({1} lignes, {2} nouvelle(s), {3} fiche(s) en attente)" -f `
                 $model, $listResult.rowsOnPage, $listResult.stored, $pending) 'Green'

      if ($needed.Count -gt 0) {
        $detail = Send-DetailPages -Model $model -Numbers $needed -Pending $pending
        $color = 'Green'
        if ($detail.Remaining -gt 0) { $color = 'DarkGreen' }
        Write-Log ("{0} : {1} fiche(s) enregistree(s), {2} en attente" -f `
                   $model, $detail.Applied, $detail.Remaining) $color
      }
    }
    $script:Rejections = 0
  }
  catch {
    $status = Get-HttpStatus $_
    if ($status -eq 401) {
      # Cle refusee. Apres plusieurs refus d'affilee le programme s'arrete :
      # c'est l'arret a distance, quand l'administrateur revoque la cle.
      $script:Rejections++
      Write-Log "Envoi refuse par le serveur ($($script:Rejections)/$MaxConsecutiveRejections)." 'Red'
      Write-ClockHint $_
      if ($script:Rejections -ge $MaxConsecutiveRejections) {
        Write-Log "La cle est refusee ou a ete revoquee. Arret de la synchronisation." 'Red'
        Write-Log "Si une nouvelle cle vous a ete fournie : supprimez live-sync.key puis relancez live-sync.bat." 'Yellow'
        exit 2
      }
    }
    else {
      # Wi-Fi coupe, site lent, serveur indisponible : on note et on continue.
      Write-Log "Probleme : $($_.Exception.Message)" 'Red'
    }
    $script:Session = $null
  }

  if ($MaxCycles -gt 0 -and $cycle -ge $MaxCycles) {
    Write-Log "Fin ($MaxCycles cycle(s) demande(s))." 'Cyan'
    break
  }

  Write-Log "Prochain cycle dans $IntervalSeconds s." 'DarkGray'
  Start-Sleep -Seconds $IntervalSeconds
}
