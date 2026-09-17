@echo off
REM =====================================================================
REM  SEBN TN3 - Rework Live Sync
REM
REM  DOUBLE-CLIQUEZ SUR CE FICHIER, puis laissez la fenetre ouverte.
REM
REM  Le script lit le site rework interne et envoie les donnees au
REM  tableau de bord en ligne. Il ne modifie rien sur le site.
REM
REM  Rien a installer. Doit etre lance depuis un PC du reseau SEBN.
REM
REM  -ExecutionPolicy Bypass : evite le blocage des scripts PowerShell
REM  sur les postes d'entreprise, sans rien modifier sur la machine.
REM =====================================================================
title SEBN TN3 - Rework Live Sync

REM Le secret doit etre le meme que SYNC_SECRET sur le serveur.
REM Remplacez la valeur ci-dessous par celle qui vous a ete communiquee.
set SYNC_SECRET=CHANGEME-mettre-le-meme-secret-que-sur-railway

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0live-sync.ps1"

echo.
echo La synchronisation s'est arretee.
pause
