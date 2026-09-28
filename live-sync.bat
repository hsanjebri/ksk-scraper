@echo off
REM =====================================================================
REM  SEBN TN3 - Rework Live Sync
REM
REM  DOUBLE-CLIQUEZ SUR CE FICHIER, puis laissez la fenetre ouverte.
REM
REM  Le script lit le site rework interne et envoie les donnees au
REM  tableau de bord en ligne. Il ne modifie rien sur le site.
REM
REM  Rien a installer, aucun droit administrateur, aucun port ouvert.
REM  Doit etre lance depuis un PC du reseau SEBN.
REM
REM  AUCUNE CLE NE DOIT ETRE ECRITE DANS CE FICHIER. Au premier lancement
REM  le script demande la cle une fois et l'enregistre chiffree par
REM  Windows (fichier live-sync.key, lisible uniquement par ce compte).
REM
REM  -ExecutionPolicy Bypass : s'applique a cette seule execution, ne
REM  modifie aucun reglage de la machine. Voir SECURITY.md : le service
REM  informatique peut signer le script et retirer cette option.
REM =====================================================================
title SEBN TN3 - Rework Live Sync

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0live-sync.ps1"

echo.
echo La synchronisation s'est arretee.
pause
