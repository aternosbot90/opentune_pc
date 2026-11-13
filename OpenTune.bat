@echo off
title OpenTune Launcher
set ELECTRON_RUN_AS_NODE=

if exist "%~dp0OpenTune-Portable.exe" (
    start "" "%~dp0OpenTune-Portable.exe"
    exit
)

if exist "%~dp0desktop\dist\win-unpacked\OpenTune.exe" (
    start "" "%~dp0desktop\dist\win-unpacked\OpenTune.exe"
    exit
)

echo Neither OpenTune-Portable.exe nor unpacked build found.
pause
