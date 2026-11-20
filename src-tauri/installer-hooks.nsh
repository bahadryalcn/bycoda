; Tauri installer hooks (bundle.windows.nsis.installerHooks).

; The updater starts this installer with /UPDATE and immediately exits the app.
; A process that is still exiting refuses Restart Manager shutdown, so the stock
; running-app check right after this hook aborted updates with "Failed to kill".
; Wait up to about 30 seconds (40 polls) for every process using the old executable to leave;
; anything still running afterwards gets the stock close prompt and error.
!macro NSIS_HOOK_PREINSTALL
  ${If} $UpdateMode = 1
    Push $0
    Push $1
    Push $2
    Push $3
    Push $R4
    Push $R5
    Push $R6
    StrCpy $R5 0
    ${Do}
      !insertmacro RestartManager_StartSession $R4
      ${If} $R4 == ""
        ${Break}
      ${EndIf}
      !insertmacro RestartManager_RegisterFile $R4 "$INSTDIR\${MAINBINARYNAME}.exe"
      StrCpy $R6 $0
      ${If} $R6 = 0
        ; ERROR_MORE_DATA means at least one process still uses the executable.
        System::Call 'RSTRTMGR::RmGetList(p R4, *i .r1, *i .r2, p 0, *i .r3) i .r0'
        StrCpy $R6 $0
      ${EndIf}
      !insertmacro RestartManager_EndSession $R4
      ${If} $R6 != ${ERROR_MORE_DATA}
      ${OrIf} $R5 >= 40
        ${Break}
      ${EndIf}
      IntOp $R5 $R5 + 1
      Sleep 500
    ${Loop}
    Pop $R6
    Pop $R5
    Pop $R4
    Pop $3
    Pop $2
    Pop $1
    Pop $0
  ${EndIf}
!macroend
