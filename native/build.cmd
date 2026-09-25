@echo off
rem Compila os ajudantes nativos para bin\ (precisa do Visual Studio Build Tools com C++ e o SDK do Windows)
setlocal
set "PF86=%ProgramFiles(x86)%"
if "%PF86%"=="" set "PF86=C:\Program Files (x86)"
"%PF86%\Microsoft Visual Studio\Installer\vswhere.exe" -latest -products * -property installationPath > "%TEMP%\tela-p2p-vs.txt" || exit /b 1
set /p VS=<"%TEMP%\tela-p2p-vs.txt"
call "%VS%\VC\Auxiliary\Build\vcvars64.bat" >nul 2>nul || exit /b 1
cd /d "%~dp0"
if not exist obj mkdir obj
rem Só um: build.cmd videocap
set FLAGS=/nologo /O2 /EHsc /std:c++20 /utf-8 /MT /DNOMINMAX /Foobj\
if /i not "%1"=="videocap" cl %FLAGS% audiocap.cpp /Fe..\bin\audiocap.exe ole32.lib shell32.lib version.lib || exit /b 1
cl %FLAGS% videocap.cpp /Fe..\bin\videocap.exe d3d11.lib dxgi.lib windowsapp.lib shell32.lib user32.lib || exit /b 1
