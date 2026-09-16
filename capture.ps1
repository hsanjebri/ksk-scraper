# =====================================================================
#  Rework Capture - SEBN TN3
#  Recupere automatiquement les pages du site rework pour analyse.
#
#  Rien a installer : PowerShell est deja present sur tout PC Windows.
#  Doit etre lance depuis un PC connecte au reseau SEBN.
#
#  Il enregistre dans le dossier "captured" :
#     list-MAM.html / list-MCM.html   la page de resultats
#     detail-<model>-<no>.html        une fiche detail par modele
#     resume.txt                      un resume a envoyer
# =====================================================================

$ErrorActionPreference = 'Stop'
$Base = 'http://rework.jenapp0001.sebn.com'
$Out  = Join-Path $PSScriptRoot 'captured'
$Models = @('MAM', 'MCM')

# Les libelles attendus sur une fiche detail. On verifie lesquels sont
# reellement presents : c'est exactement ce qui manque pour finir le scraper.
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

New-Item -ItemType Directory -Force -Path $Out | Out-Null

Say "============================================"
Say " Rework Capture - SEBN TN3"
Say " $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
Say "============================================"
Say ""

# --- 1. Session -------------------------------------------------------
# Le POST de recherche echoue sans cookie : on visite main.php d'abord.
try {
  Say "1) Connexion a $Base ..."
  $null = Invoke-WebRequest -Uri "$Base/main.php" -SessionVariable sess `
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
  $lines | Set-Content -Path (Join-Path $Out 'resume.txt') -Encoding UTF8
  Read-Host "Appuyez sur Entree pour fermer"
  exit 1
}

$detailFound = $false

foreach ($model in $Models) {
  Say ""
  Say "2) Recherche modele $model ..."

  # Le formulaire envoie ses 7 champs, pas seulement "model".
  $body = "numer=&model=$model&kenn=&rej1=&rej2=&komentar=&kolor="

  try {
    $resp = Invoke-WebRequest -Uri "$Base/Szczegol.php?AK=1" -Method POST `
                              -Body $body -ContentType 'application/x-www-form-urlencoded' `
                              -WebSession $sess -UseBasicParsing -TimeoutSec 60
  }
  catch {
    Say "   ECHEC recherche $model : $($_.Exception.Message)"
    continue
  }

  $html = $resp.Content
  $listPath = Join-Path $Out "list-$model.html"
  Set-Content -Path $listPath -Value $html -Encoding UTF8

  $rowCount = ([regex]::Matches($html, '<tr\s+bgcolor="?#DEDEDF"?>')).Count
  Say "   OK - $($html.Length) octets, $rowCount lignes trouvees"
  Say "   -> list-$model.html"

  # --- 3. Une fiche detail (le lien est dans la liste) ---------------
  $m = [regex]::Match($html, 'Szczegol\.php\?numer=(\d+)&(?:amp;)?model=' + $model)
  if (-not $m.Success) {
    Say "   !! aucun lien de fiche trouve pour $model"
    continue
  }

  $no = $m.Groups[1].Value
  Say ""
  Say "3) Fiche detail $model #$no ..."

  try {
    $d = Invoke-WebRequest -Uri "$Base/Szczegol.php?numer=$no&model=$model" `
                           -WebSession $sess -UseBasicParsing -TimeoutSec 60
  }
  catch {
    Say "   ECHEC fiche $no : $($_.Exception.Message)"
    continue
  }

  $detailHtml = $d.Content
  Set-Content -Path (Join-Path $Out "detail-$model-$no.html") -Value $detailHtml -Encoding UTF8
  Say "   OK - $($detailHtml.Length) octets"
  Say "   -> detail-$model-$no.html"
  $detailFound = $true

  # Quels libelles sont reellement sur la page ? C'est l'info cle.
  $present = @()
  $missing = @()
  foreach ($label in $Labels) {
    if ($detailHtml -match [regex]::Escape($label)) { $present += $label }
    else { $missing += $label }
  }

  Say ""
  Say "   CHAMPS TROUVES ($($present.Count)/$($Labels.Count)) :"
  Say "     $($present -join ', ')"
  if ($missing.Count -gt 0) {
    Say "   CHAMPS ABSENTS :"
    Say "     $($missing -join ', ')"
  }

  # Un apercu du texte brut aide a voir la mise en page reelle.
  $text = [regex]::Replace($detailHtml, '<[^>]+>', ' | ')
  $text = [regex]::Replace($text, '\s+', ' ').Trim()
  if ($text.Length -gt 1200) { $text = $text.Substring(0, 1200) + ' ...' }
  Say ""
  Say "   APERCU DU CONTENU :"
  Say "   $text"
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

$lines | Set-Content -Path (Join-Path $Out 'resume.txt') -Encoding UTF8
Write-Host ""
Write-Host "Resume enregistre : $(Join-Path $Out 'resume.txt')" -ForegroundColor Green
Read-Host "Appuyez sur Entree pour fermer"
