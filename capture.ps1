# =====================================================================
#  Rework Capture - SEBN TN3   (v2)
#  Recupere automatiquement des pages du site rework pour analyse.
#
#  Rien a installer : PowerShell est deja present sur tout PC Windows.
#  Doit etre lance depuis un PC connecte au reseau SEBN.
#
#  Il enregistre dans le dossier "captured" :
#     main.php.html                   le formulaire de recherche
#     list-MAM.html / list-MCM.html   la page de resultats complete
#     detail-<model>-<no>.html        PLUSIEURS fiches detail variees
#     list-<model>-filtre-*.html      test du filtre par dates (si accepte)
#     resume.txt                      un resume a envoyer
#
#  v2 : plusieurs fiches detail (dont des cas particuliers), le formulaire
#       main.php, les entetes HTTP (encodage), et un test du filtre de dates.
# =====================================================================

$ErrorActionPreference = 'Stop'
# REWORK_BASE permet de tester ce script hors reseau SEBN (serveur de rejeu).
$Base = $env:REWORK_BASE
if (-not $Base) { $Base = 'http://rework.jenapp0001.sebn.com' }
$Out  = Join-Path $PSScriptRoot 'captured'
$Models = @('MAM', 'MCM')
$MaxDetailsParModele = 6

# Les libelles attendus sur une fiche detail.
$Labels = @(
  'Rework ID', 'Model', 'CarID', 'ZSB', 'Car type', 'Registered', 'Week',
  'Reworked', 'Shift', 'Time (min)', 'Quality control', 'Defect shift',
  'Defect by', 'Defect date', 'Detect shift', 'Quality gate', 'Error code',
  'Part name', 'Type part', 'Description', 'ERP order', 'Board no', 'Comment'
)

$lines = New-Object System.Collections.Generic.List[string]
function Say($text) {
  Write-Host $text
  $lines.Add($text)
}
function SaveResume() {
  $lines | Set-Content -Path (Join-Path $Out 'resume.txt') -Encoding UTF8
}

New-Item -ItemType Directory -Force -Path $Out | Out-Null

Say "============================================"
Say " Rework Capture - SEBN TN3  (v2)"
Say " $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
Say "============================================"
Say ""

# --- 1. Session + formulaire de recherche ----------------------------
# Le POST de recherche echoue sans cookie : on visite main.php d'abord.
try {
  Say "1) Connexion a $Base ..."
  $main = Invoke-WebRequest -Uri "$Base/main.php" -SessionVariable sess `
                            -UseBasicParsing -TimeoutSec 30
  Say "   OK - session etablie."
}
catch {
  Say ""
  Say "   ECHEC : impossible de joindre $Base"
  Say "   $($_.Exception.Message)"
  Say ""
  Say "   >> Ce PC n'est probablement pas sur le reseau SEBN."
  Say "      Lancez ce script depuis un poste de l'usine."
  SaveResume
  Read-Host "Appuyez sur Entree pour fermer"
  exit 1
}

# La page du formulaire : elle nomme les champs de recherche (dont rej1/rej2,
# que nous soupconnons d'etre un filtre de dates).
Set-Content -Path (Join-Path $Out 'main.php.html') -Value $main.Content -Encoding UTF8
Say "   -> main.php.html"
$mainType = $main.Headers['Content-Type']
if (-not $mainType) { $mainType = '(aucun)' }
Say "   Content-Type annonce par le serveur : $mainType"

$inputs = @()
foreach ($mm in [regex]::Matches($main.Content, '<(?:input|select)[^>]*>')) {
  $tag = [regex]::Replace($mm.Value, '\s+', ' ')
  if ($tag.Length -gt 150) { $tag = $tag.Substring(0, 150) }
  $inputs += $tag
}
if ($inputs.Count -gt 0) {
  Say "   CHAMPS DU FORMULAIRE DE RECHERCHE :"
  foreach ($tag in ($inputs | Select-Object -First 20)) { Say "     $tag" }
}
else {
  Say "   (aucun champ de formulaire trouve sur main.php - page a frames ?)"
}

$detailFound = $false
$rowRe = [regex]'(?s)<tr\s+bgcolor="?#DEDEDF"?>\s*<td>(?<no>[^<]*)</td>\s*<td>[^<]*</td>\s*(?:<td>)?(?<car>.*?)</td>\s*<td>(?<zsb>[^<]*)</td>\s*<td>(?<reg>[^<]*)</td>\s*<td>(?<code>[^<]*)</td>\s*<td>(?<comment>[^<]*)</td>'

foreach ($model in $Models) {
  Say ""
  Say "2) Recherche modele $model ..."

  # Le formulaire envoie ses 7 champs, pas seulement "model".
  $body = "numer=&model=$model&kenn=&rej1=&rej2=&komentar=&kolor="

  try {
    $resp = Invoke-WebRequest -Uri "$Base/Szczegol.php?AK=1" -Method POST `
                              -Body $body -ContentType 'application/x-www-form-urlencoded' `
                              -WebSession $sess -UseBasicParsing -TimeoutSec 120
  }
  catch {
    Say "   ECHEC recherche $model : $($_.Exception.Message)"
    continue
  }

  $html = $resp.Content
  Set-Content -Path (Join-Path $Out "list-$model.html") -Value $html -Encoding UTF8

  $rowCount = ([regex]::Matches($html, '<tr\s+bgcolor="?#DEDEDF"?>')).Count
  $listType = $resp.Headers['Content-Type']
  if (-not $listType) { $listType = '(aucun)' }
  Say "   OK - $($html.Length) octets, $rowCount lignes trouvees"
  Say "   -> list-$model.html    (Content-Type : $listType)"

  # --- Quelles fiches capturer ? ------------------------------------
  # On veut des cas VARIES, pas 6 fois la meme situation : la plus recente,
  # la plus ancienne, des commentaires coupes a 60 caracteres, une ligne sans
  # CarID. C'est ce qui permet de valider le lecteur de pages.
  $rows = @()
  foreach ($mm in $rowRe.Matches($html)) {
    $rows += [pscustomobject]@{
      No      = $mm.Groups['no'].Value.Trim()
      Car     = [regex]::Replace($mm.Groups['car'].Value, '<[^>]+>', '').Trim()
      Reg     = $mm.Groups['reg'].Value.Trim()
      Comment = $mm.Groups['comment'].Value.Trim()
    }
  }

  $targets = New-Object System.Collections.Generic.List[string]
  function AddTarget($no) {
    if ($no -and -not $targets.Contains($no) -and $targets.Count -lt $MaxDetailsParModele) {
      $targets.Add($no)
    }
  }

  if ($rows.Count -gt 0) {
    Say "   ($($rows.Count) lignes analysees pour choisir des fiches variees)"
    AddTarget $rows[0].No                                    # la plus recente
    foreach ($r in ($rows | Where-Object { $_.Comment.Length -ge 60 } | Select-Object -First 2)) {
      AddTarget $r.No                                        # commentaire coupe
    }
    foreach ($r in ($rows | Where-Object { $_.Car -eq '' } | Select-Object -First 1)) {
      AddTarget $r.No                                        # sans CarID
    }
    AddTarget $rows[[int][Math]::Floor($rows.Count / 2)].No   # au milieu
    AddTarget $rows[$rows.Count - 1].No                       # la plus ancienne
  }
  else {
    # Repli : au moins les premiers liens de la page.
    foreach ($mm in ([regex]::Matches($html, 'Szczegol\.php\?numer=(\d+)&(?:amp;)?model=' + $model) | Select-Object -First 3)) {
      AddTarget $mm.Groups[1].Value
    }
  }

  if ($targets.Count -eq 0) {
    Say "   !! aucun lien de fiche trouve pour $model"
    continue
  }

  Say ""
  Say "3) Fiches detail $model ($($targets.Count)) : $($targets -join ', ')"

  foreach ($no in $targets) {
    try {
      # Sans -WebSession : on verifie que la fiche s'ouvre sans cookie.
      $d = Invoke-WebRequest -Uri "$Base/Szczegol.php?numer=$no&model=$model" `
                             -UseBasicParsing -TimeoutSec 60
    }
    catch {
      Say "   ECHEC fiche $no : $($_.Exception.Message)"
      continue
    }

    $detailHtml = $d.Content
    Set-Content -Path (Join-Path $Out "detail-$model-$no.html") -Value $detailHtml -Encoding UTF8
    $detailFound = $true

    $errRows = ([regex]::Matches($detailHtml, '<tr\s+bgcolor="?#D8D8D8"?>')).Count
    $present = @()
    $missing = @()
    foreach ($label in $Labels) {
      if ($detailHtml -match [regex]::Escape($label)) { $present += $label }
      else { $missing += $label }
    }

    $etat = 'en cours'
    if ($detailHtml -match '(?s)reworked.{0,400}?(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})') { $etat = 'termine' }

    Say "   #$no : $($detailHtml.Length) octets, $errRows ligne(s) de codes erreur, $($present.Count)/$($Labels.Count) champs, $etat"
    if ($errRows -gt 1) { Say "        ** plusieurs codes erreur - tres utile **" }
    if ($missing.Count -gt 0) { Say "        champs absents : $($missing -join ', ')" }
  }

  # Apercu texte de la premiere fiche seulement (le resume reste lisible).
  $firstPath = Join-Path $Out "detail-$model-$($targets[0]).html"
  if (Test-Path $firstPath) {
    $text = Get-Content -Path $firstPath -Raw
    $text = [regex]::Replace($text, '<[^>]+>', ' | ')
    $text = [regex]::Replace($text, '\s+', ' ').Trim()
    if ($text.Length -gt 1200) { $text = $text.Substring(0, 1200) + ' ...' }
    Say ""
    Say "   APERCU DE detail-$model-$($targets[0]).html :"
    Say "   $text"
  }

  # --- 4. Le filtre de dates est-il accepte ? ------------------------
  # Si rej1/rej2 filtrent par date d'enregistrement, le tableau de bord
  # pourra demander seulement les nouveautes au lieu de retelecharger
  # l'historique complet (700 Ko) a chaque minute.
  Say ""
  Say "4) Test du filtre de dates (champs rej1 / rej2) sur $model ..."
  $depuis = (Get-Date).AddDays(-7)
  $jusqua = Get-Date
  $formats = @('yyyy-MM-dd', 'dd.MM.yyyy', 'MM/dd/yyyy', 'dd/MM/yyyy')

  foreach ($f in $formats) {
    $d1 = $depuis.ToString($f)
    $d2 = $jusqua.ToString($f)
    $testBody = "numer=&model=$model&kenn=&rej1=$d1&rej2=$d2&komentar=&kolor="
    try {
      $t = Invoke-WebRequest -Uri "$Base/Szczegol.php?AK=1" -Method POST `
                             -Body $testBody -ContentType 'application/x-www-form-urlencoded' `
                             -WebSession $sess -UseBasicParsing -TimeoutSec 120
    }
    catch {
      Say "   format $f : ECHEC ($($_.Exception.Message))"
      continue
    }

    $n = ([regex]::Matches($t.Content, '<tr\s+bgcolor="?#DEDEDF"?>')).Count
    if ($n -gt 0 -and $n -lt $rowCount) {
      Say "   format $f ($d1 -> $d2) : $n lignes sur $rowCount  ** LE FILTRE MARCHE **"
      Set-Content -Path (Join-Path $Out "list-$model-filtre-$($f -replace '[^a-zA-Z]', '').html") `
                  -Value $t.Content -Encoding UTF8
    }
    elseif ($n -eq $rowCount) {
      Say "   format $f : $n lignes (identique au total - filtre ignore)"
    }
    else {
      Say "   format $f : $n lignes (aucun resultat)"
    }
  }
}

Say ""
Say "============================================"
if ($detailFound) {
  Say " TERMINE - fichiers dans :"
  Say " $Out"
  Say ""
  Say " >> Envoyez tout le dossier 'captured'."
} else {
  Say " TERMINE mais AUCUNE fiche detail recuperee."
  Say " Envoyez quand meme le dossier 'captured'."
}
Say "============================================"

SaveResume
Write-Host ""
Write-Host "Resume enregistre : $(Join-Path $Out 'resume.txt')" -ForegroundColor Green
Read-Host "Appuyez sur Entree pour fermer"
