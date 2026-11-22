!macro customInstall
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\Drew" "" "Drew"
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\Drew\shell\open\command" "" '"$INSTDIR\Drew.exe"'
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\Drew\Capabilities" "ApplicationName" "Drew"
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\Drew\Capabilities" "ApplicationDescription" "Drew web browser"
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\Drew\Capabilities\URLAssociations" "http" "Drew.URL"
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\Drew\Capabilities\URLAssociations" "https" "Drew.URL"
  WriteRegStr SHCTX "Software\RegisteredApplications" "Drew" "Software\Clients\StartMenuInternet\Drew\Capabilities"
  WriteRegStr SHCTX "Software\Classes\Drew.URL" "" "Drew web link"
  WriteRegStr SHCTX "Software\Classes\Drew.URL" "URL Protocol" ""
  WriteRegStr SHCTX "Software\Classes\Drew.URL\DefaultIcon" "" '"$INSTDIR\Drew.exe",0'
  WriteRegStr SHCTX "Software\Classes\Drew.URL\shell\open\command" "" '"$INSTDIR\Drew.exe" "%1"'
!macroend
!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegValue SHCTX "Software\RegisteredApplications" "Drew"
    DeleteRegKey SHCTX "Software\Clients\StartMenuInternet\Drew"
    DeleteRegKey SHCTX "Software\Classes\Drew.URL"
  ${endIf}
!macroend
