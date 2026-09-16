@echo off
REM =====================================================================
REM  Rework Capture - SEBN TN3
REM
REM  DOUBLE-CLIQUEZ SUR CE FICHIER.
REM
REM  Rien a installer. Doit etre lance depuis un PC du reseau SEBN.
REM  Le resultat est enregistre dans le dossier "captured" a cote.
REM
REM  -ExecutionPolicy Bypass : evite le blocage des scripts PowerShell
REM  sur les postes d'entreprise, sans rien modifier sur la machine.
REM =====================================================================
title Rework Capture - SEBN TN3
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0capture.ps1"
if errorlevel 1 (
  echo.
  echo Le script s'est termine avec une erreur.
  pause
)
