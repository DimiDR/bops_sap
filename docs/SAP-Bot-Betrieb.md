# SAP GrokBot – Cloud-App und Connector einrichten

## Komponenten

Die Cloud-App läuft auf einer Linux-VM pro Kunde. Caddy stellt den HTTPS-Endpunkt bereit. OAuth2 Proxy prüft die Anmeldung gegen den Entra-Tenant und die konfigurierte Pilotgruppe. Die App startet pro angemeldeter Person einen Browserprozess mit eigenem Profil. Der Connector läuft separat im Kundennetz und leitet nur konfigurierte HTTP-Methoden und SAP-Pfade an genau einen HTTPS-Upstream weiter.

## 1. Web-App mit synthetischer Testmaske

1. Auf der Cloud-VM Node.js 24, Caddy und OAuth2 Proxy installieren. Caddy mindestens in Version 2.11.2 betreiben. Den Quellcode nach `/opt/sap-grokbot` legen, den Systembenutzer `sap-grokbot` anlegen, `npm ci` und `npm run build` ausführen und Chromium inklusive Linux-Systemabhängigkeiten mit `PLAYWRIGHT_BROWSERS_PATH=/opt/sap-grokbot/.browsers npx playwright install --with-deps chromium` installieren. Der Dienstbenutzer braucht Lese- und Ausführungsrechte für den Browser. Der Host muss den Chromium-Sandboxbetrieb erlauben. Die UI läuft als Next.js (`/sap`); Caddy leitet auf den Next-Prozess weiter.
2. Im Entra-Tenant eine Single-Tenant-Web-App mit Redirect-URI `https://<app-domain>/oauth2/callback` registrieren. Den Gruppen-Claim für die Pilotgruppe aktivieren und die Gruppe der Enterprise-App zuweisen. Prüfen, welcher stabile OIDC-Benutzerwert als `X-Auth-Request-User` ankommt. Diesen Wert für die SAP-Benutzerzuordnung verwenden.
3. Die Dateien `web.env.example` und `auth.env.example` aus `sap-grokbot/deploy/` als `/etc/sap-grokbot/web.env` und `/etc/sap-grokbot/auth.env` mit echten Werten anlegen. Rechte auf Administrator und Dienst beschränken. `SAP_PROXY_SECRET` mit `openssl rand -hex 32` erzeugen und denselben Wert in der Caddy-Dienstumgebung setzen. Zusätzlich `SAP_APP_DOMAIN` für Caddy setzen. Die Secret- und Tenant-Dateien getrennt von Git verwalten.
4. Die beiden systemd-Units installieren und starten. Die Caddy-Konfiguration mit der Dienstumgebung validieren und aktivieren. Die App und OAuth2 Proxy lauschen auf Loopback. Im Cloud-Firewallprofil nur den HTTPS-Eingang des Reverse Proxy veröffentlichen.
5. Mit einem Mitglied und einer Person außerhalb der Pilotgruppe testen. Mit zwei Mitgliedern prüfen, dass beide unterschiedliche Browserzustände sehen. Beim Test mit manipuliertem Identitätsheader muss weiterhin ausschließlich die Identität aus Entra gelten.

Modellprofile können in `SAP_MODEL_PROFILES` ergänzt werden. Jedes Profil hat eine ID, die vollständige Chat-Completions-URL, eine Modell-ID und optional den Namen einer Umgebungsvariablen mit dem Schlüssel. Profile erscheinen im Chat als Auswahl. Ein expliziter lokaler Befehl bleibt lokal. Bei Freitext sendet die App den Auftrag an das ausgewählte Modell. Die Modellantwort kann nur Lesen oder einen Änderungsvorschlag anfordern. Die Ausführung und Freigabe liegen im Worker. Vor einem Kundeneinsatz muss der ausgewählte Modellendpunkt für die Daten freigegeben sein.

## 2. Connector im Kundennetz

1. Einen dedizierten Linux-Host bereitstellen. Er muss den internen SAP-Web-Dispatcher per HTTPS erreichen. Den Systembenutzer `sap-connector` anlegen und `sap-connector.service` installieren. Auf diesem Host benötigt der Connector nur Node.js und die Datei `sap-grokbot/connector/server.mjs`.
2. Connector-Host und Cloud-VM im freigegebenen Tailnet registrieren. Per Tailnet-Zugriffsregel ausschließlich die zugehörige Cloud-VM für TCP 443 am Connector zulassen. Die Regeln pro Kunde getrennt halten. Im Kundennetz ist kein eingehender Internet-Port für diesen Dienst vorgesehen.
3. `connector.env.example` als `/etc/sap-grokbot/connector.env` anlegen. Den exakten internen Upstream und den Tailnet-HTTPS-Namen eintragen. Für eine private Zertifizierungsstelle das CA-Zertifikat über `NODE_EXTRA_CA_CERTS` ergänzen. Die Beispielpfade sind Platzhalter für den ausgewählten Fiori-Prozess. Für SAML die tatsächlich benötigten Ressourcen und Rücksprungpfade einzeln freigeben.
4. Connector starten und auf dem Kundenhost `tailscale serve --bg 3212` einrichten. Von der Cloud-VM aus einen erlaubten Pfad testen. Ein nicht freigegebener Pfad und eine nicht freigegebene Methode müssen 403 ergeben. Mit `tailscale serve --https=443 off` kann der Kunde den Zugang deaktivieren.
5. SAP Basis richtet den externen Namen als unterstützten Zugriffsweg ein. SAP-generierte Links, Cookie-Domains und Entra-/SAML-Rücksprungadressen müssen zu diesem Namen passen. Der Connector schreibt zugelassene HTTP-Weiterleitungen um. SAP-Seiteninhalte und Cookies werden unverändert weitergegeben.

Der Connector protokolliert Zeitpunkt, Regel-ID und HTTP-Status ohne Request-Inhalte. Er lehnt kodierte Pfade, Traversal, Method-Override-Header und OData-`$batch` ab beziehungsweise entfernt die Override-Header. Apps, deren Einstieg diese Funktionen voraussetzt, benötigen einen gesondert geprüften Adapter und eine konkrete Freigabe.

## 3. Lokaler SAP-Test ohne Entra

Für Einzelplatz-Tests gegen eine echte SAP-URL kann Entra bewusst abgeschaltet werden. Standard bleibt `SAP_AUTH_MODE=entra` (bzw. unset). Der No-Auth-Modus ist nur mit explizitem `SAP_AUTH_MODE=none` aktiv. Die App lauscht weiterhin ausschließlich auf `127.0.0.1`, schreibt das Audit mit einer festen lokalen Testidentität und behält Freigabe, Origin-Prüfung und Host-Check bei. OAuth2 Proxy, Caddy und `SAP_PROXY_SECRET`/`SAP_ENTRA_GROUP` entfallen in diesem Modus.

```bash
export SAP_AUTH_MODE=none
export SAP_AUDIT_FILE="$PWD/.data/sap-audit.jsonl"
export SAP_LOCAL_ACTOR=local-test
export SAP_USER_MAP='{"local-test":"SAP_TEST_USER"}'
export SAP_BROWSER_TARGET='{"url":"https://sap.example/sap/bc/ui2/flp","label":"Testauftrag","loginOrigins":["https://login.microsoftonline.com"],"identitySelector":"[data-example-sap-user]","recordSelector":"[data-example-order-id]","recordValue":"4500000173","noteSelector":"[data-example-saved-note]","writes":false}'
mkdir -p .data
npm run sap:demo
# UI: http://127.0.0.1:3211/sap
```

Optional: `SAP_APP_ORIGIN=http://127.0.0.1:3211` (nur Loopback). Ein nicht-lokaler Origin wird abgelehnt. Beim Start erscheint eine deutliche Warnung. Nicht im Netz exponieren. Die Oberfläche ist die Bops-Chat-UI unter `/sap`; APIs unter `/api/sap/*`.

## 4. Einen SAP-Prozess anbinden

1. Einen freigegebenen Fiori- oder WebGUI-Leseprozess mit Testdaten auswählen. `SAP_BROWSER_TARGET` mit Start-URL, erlaubten Login-Origins und Selektoren für das sichtbare SAP-Konto, die feste Datensatz-ID und die gespeicherte Notiz konfigurieren. `SAP_USER_MAP` ordnet jedem Entra-Benutzer genau sein SAP-Konto zu. Ohne `SAP_AUTH_MODE=none` setzt ein echtes SAP-Ziel den authentifizierten Cloud-Modus mit Entra voraus. Der Worker prüft Konto und Datensatz vor einem Lese- oder Schreibzugriff. Die Selektoren sind pro Testprozess zu ermitteln.
2. Im Live-Browser **Übernehmen** wählen und die persönliche SAP-Anmeldung inklusive MFA abschließen. Für Text in sensiblen Feldern **Eingabe verdecken** aktivieren. Wenn Conditional Access einen verwalteten Browser verlangt, den tatsächlich freigegebenen Browser auf der Cloud-VM einrichten und dessen ausführbare Datei über `SAP_DEMO_BROWSER` vorgeben. Cloud-Firewall und Tailnet begrenzen zusätzlich den Netzwerkzugang des Workers. Die browserseitige URL-Filterung ist ergänzend, weil Browser-Weiterleitungen den Filter nicht für jeden Folgeaufruf erneut durchlaufen.
3. Zuerst lesen und einen absichtlich falsch zugeordneten SAP-Benutzer testen. Dann bei ausdrücklicher Freigabe `writes`, `editSelector`, `saveSelector`, `saveRequestPath` und `saveMethod` konfigurieren. Der Browser wartet beim Schreiben auf die erwartete HTTP-Antwort, lädt die konfigurierte Ansicht neu und liest den gespeicherten Wert zurück. Schreibfreigabe und Server-SAP-Berechtigungen getrennt prüfen. In der manuellen Übernahme gelten die Berechtigungen des angemeldeten SAP-Kontos.

## Abnahme und Grenzen

- Die bereitgestellten Dienste sind für eine einzelne Kunden-VM ausgelegt. Jede Person hat einen separaten Browserprozess. Automatische VM-Bereitstellung pro Person, Hochverfügbarkeit und getrennte VM-Netzwerke sind weitere Infrastrukturarbeit.
- Das Cloud-Audit schreibt App-Ereignisse ohne Notiztext oder Screenshots in eine geschützte JSONL-Datei. Revisionssicherer externer Speicher, SAP-Anwendungsprotokoll, Aufbewahrung und Offboarding brauchen die betrieblichen Vorgaben und eine SAP-seitige Umsetzung.
- Der Connector transportiert HTTPS. Direkte RFC/BAPI-Aufrufe, ARC-1/ADT, SAP GUI for Java oder Windows und AVD sind eigenständige Integrationspakete.
- Der echte Nachweis umfasst Entra-Login, SAP-SSO und Conditional Access, Verbindung über den Kundentunnel, Berechtigungsprüfung und Rücklesen in SAP. Dafür sind die realen Endpunkte, Identitäten, Zugriffsfreigaben und der ausgewählte Prozess erforderlich.

Referenzen: [Microsoft Entra OIDC](https://learn.microsoft.com/en-us/entra/identity-platform/v2-protocols-oidc) · [OAuth2 Proxy](https://oauth2-proxy.github.io/oauth2-proxy/configuration/overview/) · [Caddy Forward Auth](https://caddyserver.com/docs/caddyfile/directives/forward_auth) · [Tailscale Serve](https://tailscale.com/docs/reference/tailscale-cli/serve) · [Playwright-Routing](https://playwright.dev/docs/api/class-page#page-route)
