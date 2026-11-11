# SAP-Bot für Mitarbeitende – Architektur, Konzept und Erkenntnisse

Stand: 2026-11-09 · Autor: Dimitri Rybak · Online-Fassung: https://claude.ai/artifact/L614nchKkhqmPfJAgTLx5C

Dieses Dokument fasst alle Erkenntnisse aus der Analyse des Bops-Repos und der anschließenden Architekturdiskussion zusammen: Zielbild, Entscheidungen, geprüfte Alternativen, Faktencheck gegen die SAP-Dokumentation, Tests auf dem lokalen Rechner und offene Punkte.

---

## 1. Zusammenfassung

Jede Mitarbeiterin und jeder Mitarbeiter des Kunden bekommt einen KI-Bot mit eigenem Computer in unserer Cloud, der SAP im Namen und mit den Berechtigungen dieser Person bedient. Ins Kundennetz kommen wir über einen eigenen Connector, der nur ausgehend verbindet; der Kunde muss keine Cloud-PCs betreiben. Grundlage ist die Architektur von Bops (OrgoAI), die wir als Referenz nutzen.

| Thema | Entscheidung |
| --- | --- |
| Zielgruppe | Mitarbeitende des Kunden, nicht Berater |
| Login | Entra ID (OIDC) |
| Netzwerk | Eigener Connector im Kundennetz, nur ausgehend über 443, Allowlist auf Pfadebene |
| Bot-Computer | Linux-VMs in unserer Cloud; Windows-VMs nur als Ausnahme |
| Identität des Bots | Der User selbst: SAP-SSO per SAML (Entra ID) bzw. X.509 |
| SAP für Fachanwender | Fiori Launchpad und WebGUI im Browser; klassische Transaktionen zusätzlich über SAP GUI for Java mit Scripting; Buchungen bevorzugt über RFC/OData |
| ABAP-Entwicklung | ADT-REST-API über den MCP-Server ARC-1 |
| KI | Eigene, selbst gehostete KI |
| Audit | Vier Ebenen mit Korrelations-ID, inklusive eigenem Protokoll in SAP |
| Betriebsrat | Löschkonzept und keine Leistungskontrolle |
| Alternative | Cloud-PCs mit AVD im Kunden-Tenant, falls der Kunde keinen Connector erlaubt |
| Lizenz (FSL) | vorerst zurückgestellt |

---

## 2. Ausgangslage: das Bops-Repo

Bops ist eine Mac-App (Electron), die lokal einen Next.js-Server (Port 3210) startet; die Bots arbeiten auf Linux-Cloud-VMs von Orgo und laufen ausschließlich auf OpenAI (Responses API mit `computer`-Tool, Agents API, Codex CLI). Fast alle Teile, die wir ändern müssen, sind genau diese Kernteile.

| Bereich in Bops | Heute | Im Zielbild |
| --- | --- | --- |
| App-Hülle (`desktop/`) | Electron-Mac-App, Server auf dem Rechner des Users | Entfällt; zentrale Web-App |
| Server (`app/`, `lib/server/`) | Next.js, Chats, Threads, Routinen, Freigaben | Konzepte übernehmen, neu aufbauen |
| Cloud-PCs (`lib/server/orgo.ts`, `orgo/`, `vm/`) | Orgo-Linux-VMs, xdotool, Displays `:99`–`:102` | Linux-Bot-Computer in unserer Cloud plus Connector; Windows nur als Ausnahme |
| Agent-Loop (`computer-task.ts`, `responses-ws.ts`) | OpenAI Responses API, `computer`-Tool | Eigener Loop mit Tool-Calling auf eigener KI |
| Lokaler Mac-Pfad (`local.ts`, `executor-sandbox.ts`, `vm/mac-ui-mcp.mjs`) | Codex CLI, `sandbox-exec`, Cua Driver | Entfällt |
| Secrets (`keychain.ts`) | macOS Keychain (`security` CLI) | Azure Key Vault; User-Secrets entfallen dank SSO |
| Login (`orgo-auth.ts`, `sign-in.ts`) | Orgo, Google, E-Mail | Entra ID |
| Datenschutz (`deleted.ts`, `lib/privacy.ts`, `cloud/delete-user.ts`) | Aufbewahrungsfristen, Papierkorb, User-Löschung | Übernehmen und erweitern |
| Netzwerk (`relay.ts`, `vm/bin/bops-tailnet`) | „Route through this Mac“, Tailscale für Bot-VMs | Tailscale-Ansatz als Basis für den Connector |

Wiederverwendbar sind vor allem Konzepte: Freigabe-Flow („Asks before it acts“, `lib/server/permission.ts`), Routinen, Live-Ansicht und Übernahme („Take control“), Chat-UI (`components/message-ui/`), Browser-Steuerung per Playwright über CDP (`vm/page-script.cjs`) und die Löschlogik.

**Mac-Abhängigkeiten im Code (für einen Windows-Port relevant):**

- `lib/server/keychain.ts`: `security` CLI → unter Windows Credential Manager / DPAPI.
- `lib/server/executor-sandbox.ts`: `/usr/bin/sandbox-exec` → unter Windows kein 1:1-Ersatz (AppContainer, eingeschränkter User).
- `lib/server/codex-cli.ts`: Binary `*-apple-darwin`.
- `lib/server/local.ts`: Chrome-Pfad `/Applications/...`, Cua Driver.
- `lib/server/awake.ts`: `caffeinate`.
- `desktop/main.cjs`: osascript, TCC-Berechtigungen, `spawn("npx")` ohne Shell, `/bin/zsh`, `/bin/sh`.
- `package.json`, `scripts/*.sh`: `electron-builder --mac`, `ditto`, Bash-Skripte.

---

## 3. Zielarchitektur

Der Kunde installiert nur unseren Connector; Web-App, KI, ARC-1 und die Bot-Computer laufen in unserer Cloud. Der Connector verbindet ausschließlich ausgehend und lässt nur freigegebene SAP-Pfade durch.

```
Kundennetz                                         Unsere Cloud
┌──────────────────────────────────┐              ┌──────────────────────────────────────┐
│ S/4HANA bzw. ECC                 │              │ Web-App und Tunnel-Endpunkt          │
│ (Fiori, WebGUI, OData, RFC, ADT) │              │  Chat, Freigaben, Routinen           │
│ hinter Web Dispatcher/SAProuter  │              │  Audit-Protokoll (WORM)              │
│            ▲ nur erlaubte Pfade  │              │  Eigene KI, ARC-1 (ABAP-MCP)         │
│            │                     │  Tunnel,     ├──────────────────────────────────────┤
│ Unser Connector                  │  ausgehend   │ Bot-Computer (Linux)                 │
│  Linux-VM oder Container         │ ═══ 443 ═══▶ │  Chrome mit Fiori/WebGUI, UI5-Tools  │
│  Allowlist auf Pfadebene,        │              │  SAP GUI for Java mit Scripting      │
│  Protokoll, Aus-Schalter         │              │  Live-Ansicht und Übernahme          │
└──────────────────────────────────┘              ├──────────────────────────────────────┤
                                                  │ Windows-VMs (Ausnahme)               │
Entra ID des Kunden (Cloud) ── SAML-SSO ────────▶ │  SAP GUI for Windows Scripting       │
                                                  └──────────────────────────────────────┘
```

Fachanwender-Aufgaben laufen im Chrome der Linux-Bot-Computer über Fiori und WebGUI; Buchungen bevorzugt über RFC/OData, ABAP-Entwicklung über ARC-1. Windows-VMs betreiben wir nur für Transaktionen, die weder im Browser noch mit SAP GUI for Java laufen. Falls ein Kunde keinen Connector erlaubt, gibt es die Alternative mit Cloud-PCs im Kunden-Tenant (Abschnitt 9).

---

## 4. Connector ins Kundennetz

Unser Connector ersetzt VPN und Cloud-PCs beim Kunden: eine kleine Linux-VM oder ein Container im Kundennetz, die eine **ausgehende** Verbindung über 443 zu unserer Cloud aufbaut. Eingehende Ports beim Kunden sind nicht nötig. Der SAP Cloud Connector selbst ist dafür nicht nutzbar, weil er nur mit BTP-Subaccounts verbindet.

**Aufbau**

- **Tunnel:** bewährte WireGuard-Technik (Tailscale bzw. selbst gehostet Headscale oder Netbird, alternativ Cloudflare Tunnel) mit Fallback über 443/TCP für Netze mit TLS-Inspection. Kein eigenes Tunnelprotokoll. Bops kann Bot-VMs bereits einem Tailnet beitreten lassen (`vm/bin/bops-tailnet`, `TAILSCALE_AUTH_KEY`); ein Subnet-Router im Kundennetz macht SAP damit fast ohne neuen Code erreichbar.
- **HTTP-Proxy im Connector:** Allowlist auf Pfadebene, z. B. Fiori Launchpad, `/sap/bc/ui5_ui5/`, `/sap/opu/odata/`, `/sap/bc/gui/sap/its/webgui`, `/sap/bc/adt/` (nur Entwicklungssysteme).
- **Layer-4-Weg** für SAP GUI (DIAG `32NN`, Message Server `36NN`) und RFC (`33NN`), standardmäßig aus; optional über den vorhandenen SAProuter des Kunden (Route-Strings `/H/<host>/S/<port>/H/…`).
- **Kontrolle beim Kunden:** Protokoll jeder Anfrage, Aus-Schalter, Allowlist in seiner Hand, idealerweise Betrieb in der DMZ.

**Damit Fiori im Bot-Browser funktioniert**

- Split-DNS über den Tunnel, damit die internen Hostnamen (FQDN) aufgelöst werden.
- Root-Zertifikat der internen CA des Kunden im Chrome der Bot-Computer.
- Alle beteiligten Hosts in der Allowlist: Web Dispatcher, Front-End-Server (Hub-Deployment), Backend für WebGUI-Kacheln.

**Was über den Connector erreichbar ist (S/4HANA)**

- Fiori-Apps (UI5) und die OData-Services dahinter.
- Klassische Transaktionen als WebGUI-Kacheln im Launchpad.
- Web-Dynpro-Apps.
- Lücken nur bei Transaktionen, die SAP GUI for HTML nicht unterstützt, und bei einigen Basis-/Entwicklungswerkzeugen.

**Voraussetzungen je Release**

| System | Browser-Weg | Hinweis |
| --- | --- | --- |
| S/4HANA | Fiori Launchpad, WebGUI-Kacheln, OData | Sauberster Weg |
| ECC 6.0, EHP6 bis EHP8 (Basis 7.31 bis 7.50) | WebGUI (integrierter ITS), SAML-SSO | SICF-Service `webgui` aktivieren; neuere Patch-Stände haben den besseren DOM |
| ECC 6.0, ältere EHPs | WebGUI eingeschränkt, SAML-Mindestrelease ungeklärt | Einzelfall prüfen |
| R/3 4.x | nur externer ITS (außer Wartung) | Praktisch nicht nutzbar |

Wartung: Die Mainstream-Wartung bis Ende 2027 (optional erweitert bis Ende 2030) gilt nur für ECC 6.0 mit EHP6 bis EHP8; ältere EHPs sind seit Ende 2025 aus der Mainstream-Wartung.

**Folgen für Kunde und Vertrag**

- Die Kunden-Security bewertet den Connector als Fernzugriff ins SAP-Netz (ISO 27001, NIS2).
- SAP-Daten und Masken werden in unserer Cloud verarbeitet: AVV nötig, Region festlegen, KI bei uns gehostet.

---

## 5. Identität und SSO

Der Bot arbeitet immer als der User selbst: gleiche Entra-Identität in der Web-App und im SAP-System. Es werden keine SAP-Passwörter gespeichert.

1. **Web-App:** Login per Entra ID (OIDC), App-Registrierung im Tenant des Kunden; Zugriff über eine Entra-Gruppe.
2. **Fiori und WebGUI:** Anmeldung per SAML-SSO über Entra ID im Browser des Bot-Computers. Voraussetzungen auf AS ABAP: SSL, CommonCryptoLib, Artifact Binding statt POST, Secure Session Management.
3. **Bot-Computer:** brauchen keine Windows-Anmeldung des Users; der Bot meldet sich direkt per SSO bei SAP an.
4. **SAP GUI, RFC und ADT:** SNC-SSO, je nach Landschaft:
   - **SAP Secure Login Service** (über SAP IAS an Entra ID gekoppelt): X.509-Zertifikate „on the fly“, ohne eigene PKI. Bevorzugt.
   - **Kerberos:** nur in der AVD-Alternative, weil unsere Bot-Computer nicht in der Domäne des Kunden sind; braucht hybride Identität und Erreichbarkeit eines Domain Controllers bzw. Kerberos Cloud Trust.
   - Logon Tickets werden von SAP nicht mehr empfohlen.
5. **User-Mapping:** Entra-UPN auf SAP-User (SAML-NameID bzw. SNC-Name in SU01).

**Conditional Access ist der kritische Punkt.** MFA und die Pflicht zu verwalteten Geräten können den Browser des Bots blockieren. Drei Wege, mit dem Kunden abzustimmen:

| Weg | Ablauf | Eignung |
| --- | --- | --- |
| User meldet sich selbst an | Login mit MFA in der Live-Ansicht des Bot-Bildschirms („Take control“), danach arbeitet der Bot, solange die SAP-Sitzung gültig ist | Einfach, für Aufgaben im Dialog |
| Kurzlebige X.509-Zertifikate | Secure Login Service stellt Zertifikate pro User aus | Unbeaufsichtigte Routinen; Kunde muss es einrichten |
| Ausnahme im Conditional Access | Zugriff von festen IP-Adressen der Bot-Computer erlaubt | Nur mit Zustimmung der Kunden-Security |

Folge: Der Bot darf genau das, was die Person darf. Funktionstrennung (SoD) und SAP-Berechtigungen bleiben unverändert wirksam.

---

## 6. SAP-Zugriff

Für Fachanwender ist der Browser der Hauptkanal: Fiori Launchpad und WebGUI-Kacheln im Chrome der Linux-Bot-Computer. Die UI5-Oberfläche hat einen Control-Baum mit IDs und Datenbindungen, den der Bot gezielt ausliest; wo es passt, ruft er die OData-Services der App direkt in der Sitzung des Users auf. Grundsatz: strukturierter Zugriff vor Pixeln.

| Kanal | Wofür | Läuft auf |
| --- | --- | --- |
| Fiori Launchpad (UI5) | Fiori-Apps, Control-Baum statt Pixel | Linux-Bot-Computer, Chrome |
| WebGUI (SAP GUI for HTML) | Klassische Transaktionen im Browser, auch als Kachel im Launchpad; nur eine Sitzung pro Anmeldung | Linux-Bot-Computer, Chrome |
| OData / RFC / BAPI | Daten lesen und buchen, gut zu protokollieren | Unsere Cloud über den Connector |
| ADT über ARC-1 | ABAP-Entwicklung (Abschnitt 7) | Unsere Cloud über den Connector |
| SAP GUI for Java mit Scripting | Klassische Transaktionen mit Control-IDs, auch unter Linux (eingebaute JavaScript-Engine) | Linux-Bot-Computer; externe Steuerung im Prototyp prüfen |
| SAP GUI for Windows mit Scripting (COM) | Transaktionen, die sonst nirgends laufen | Windows-VMs in unserer Cloud (Ausnahme) |
| Screenshot + Maus/Tastatur | Letzter Fallback | überall |

**Bausteine**

- WebGUI: [Playwright-SAP](https://playwright-sap.dev/FAQs) mit SAP-spezifischen Locators (SIDs im Attribut `lsdata`).
- SAP GUI for Windows: MCP-Server [mcp-sap-gui (kts982)](https://images.glama.ai/mcp/servers/kts982/mcp-sap-gui) (Screens und Tabellen lesen, Felder füllen, Popups, Read-only-Modus, Transaktions-Whitelist, Bestätigungspunkte für Schreibaktionen). Weitere: KTern sapguimcp, sapient-mcp.
- OData auf BTP: btp-sap-odata-to-mcp-server (lemaiwo), falls ein Kunde BTP nutzt.

**WebGUI-Fakten (SAP-Doku)**

- URL: `http(s)://<host>:<port>/sap/bc/gui/sap/its/webgui`; ICF-Pfad `/default_host/sap/bc/gui/sap/its/`; Services `system` und `webgui` publizieren; Profilparameter `itsp/enable`.
- Einschränkungen: kein Drag and Drop, keine SAP-Shortcuts, keine Feldhistorie, **keine Mehrfachsitzungen** (für parallele Arbeit mehrere Anmeldungen), weitere in SAP-Hinweis 314568.
- GUI-Unterstützung pro Transaktion in SE93 (Registerkarte User Interface).

**SAP GUI Scripting-Fakten (SAP-Doku)**

- Serverseitig über `sapgui/user_scripting` (Standard: aus; Wert `TRUE`, Ab- und Anmelden genügt). Feiner: `sapgui/user_scripting_set_readonly` (nur lesen), `sapgui/user_scripting_disable_recording`. Freigabe auch für einzelne User möglich (SAP-Hinweis 983990).
- Clientseitig: Scripting aktivieren; Hinweise „Notify when a script attaches“ und „… opens a connection“ abschaltbar.
- Verfügbar für SAP GUI for Windows **und Java** (seit 6.20 bzw. Java 6.20 Rev. 6). SAP GUI for Java läuft unter Windows, macOS und Linux, hat eine eingebaute JavaScript-Engine und Optionen für externe Skripte (`session.findById("wnd[0]/…")`).

**Sicherheitsregeln für den Bot**

- Standard ist Read-only; für reine Lese-Bots kann SAP serverseitig erzwingen, dass Scripting nur lesen darf (`sapgui/user_scripting_set_readonly`). Schreibende Aktionen brauchen die Freigabe des Users in der App.
- Whitelist für Transaktionen und Services pro Rolle oder Kunde.
- Jede Schreibaktion wird mit Freigabe im Audit-Protokoll festgehalten.
- Keine Aktionen an Benutzer- und Berechtigungsverwaltung (z. B. SU01, PFCG) und an Basis-Transaktionen.

---

## 7. ABAP-Entwicklung mit ARC-1

Für ABAP braucht der Bot keine Oberfläche: Die ABAP Development Tools (ADT) sprechen über REST-Services (`/sap/bc/adt/...`) mit dem System, und der MCP-Server ARC-1 macht diese API für den Bot nutzbar. Der Weg läuft über denselben Connector wie Fiori, aber nur zu Entwicklungssystemen.

**Was ARC-1 abdeckt:** ABAP-Quellcode (Klassen, Programme, Funktionsbausteine, Includes), CDS/RAP-Objekte, DDIC, Syntaxcheck und Aktivierung, ATC, ABAP Unit, Transportaufträge, abapGit/gCTS, Dumps/Traces.

**Sicherheitsregeln, die ARC-1 mitbringt**

- Schreiben an oder aus (`SAP_ALLOW_WRITES`), Transport-Schreibrechte getrennt (`SAP_ALLOW_TRANSPORT_WRITES`).
- Paket-Allowlist (`SAP_ALLOWED_PACKAGES`), z. B. nur Kundenpakete und `$TMP`.
- Datenvorschau und freies SQL standardmäßig aus, einzelne Aktionen sperrbar.

**Anpassungen für das Produkt**

- **Pro User anmelden statt gemeinsamem Basic-Auth-User:** über Principal Propagation (von ARC-1 auf BTP unterstützt) oder X.509 über den Connector. Erst dann stehen Änderungen unter dem Entwickler, der sie freigegeben hat.
- **Kompakter Tool-Modus** (`ARC1_TOOL_MODE=hyperfocused`): Die volle Tool-Liste umfasst rund 71 KB und geht bei jeder Anfrage mit; für eine selbst gehostete KI mit kleinerem Kontext ist das zu viel.
- **Freigaben:** Aktivieren und Transport-Freigabe erst nach Bestätigung durch den User; ATC und Unit-Tests laufen vorher automatisch.
- **Lizenz von ARC-1** vor Produktnutzung prüfen.

**Audit fällt bei ABAP leichter:** Jede Änderung liegt in einem Transportauftrag unter dem User, mit Versionsverwaltung. Produktion bleibt für Änderungen gesperrt; der Weg dorthin läuft über die bestehenden Transport- und Freigabeprozesse.

**Für Menschen, die selbst programmieren:** die offiziellen **ABAP Development Tools für VS Code** (laut SAP für das ABAP-Cloud-Entwicklungsmodell, Backends ab S/4HANA 1909; MCP-basierte Agentenfunktionen, teils lizenzpflichtig) oder Eclipse mit ADT auf dem Bot-Computer über die Live-Ansicht. Für ECC bleibt Eclipse bzw. ARC-1.

**Lokaler Test (2026-11-09):** Der konfigurierte MCP-Server `ARC1-S4P` (`C:\Users\rybak\Downloads\Apps\arc-1`, Version 1.4.0) startete nicht, weil die Abhängigkeiten fehlten (`Cannot find package 'commander'`). Nach `npm ci --omit=dev --ignore-scripts` startet er mit 11 Tools. Die Verbindung zum Testsystem scheiterte am TLS-Aufbau (curl-Fehler 35; TCP erreichbar), vermutlich VPN, Proxy oder TLS-Inspection; nicht weiter verfolgt.

---

## 8. Bot-Computer in unserer Cloud

Die Bot-Computer sind Linux-VMs in unserer Cloud, wie in Bops: Chrome für Fiori und WebGUI, Live-Ansicht und Übernahme durch den User. Weil keine Windows-Sitzung des Users nötig ist, entfallen Sitzungserhalt und Aufwecken aus dem Ruhezustand weitgehend.

- **Betrieb:** eigener Pool von Linux-VMs oder ein Anbieter wie Orgo; Region passend zum AVV.
- **Tunnel:** Jeder Bot-Computer tritt dem Tunnel des jeweiligen Kunden bei und sieht nur dessen freigegebene SAP-Pfade; strikte Trennung zwischen Kunden.
- **Sitzungen:** Der Bot meldet sich per SSO bei SAP an; ist eine Sitzung abgelaufen (z. B. durch `rdisp/gui_auto_logout`), meldet er sich neu an oder bittet den User um einen Login in der Live-Ansicht.
- **Klassische Transaktionen:** zuerst SAP GUI for Java mit Scripting auf Linux prüfen; nur wenn das nicht reicht, einzelne Windows-VMs mit SAP GUI for Windows und Scripting. Für Windows-VMs gelten die Regeln zu Sitzung und Aufwecken aus Abschnitt 9.

---

## 9. Alternative: Cloud-PCs im Kunden-Tenant (AVD)

Diese Variante gilt, wenn ein Kunde keinen Connector erlaubt, aber Cloud-PCs in seinem eigenen Azure-Tenant betreibt. Die Regeln zu Sitzung und Aufwecken gelten außerdem für unsere Windows-VMs.

Der Bot braucht eine laufende Windows-Sitzung des Users. Deshalb schläft die VM nur per Hibernate (Sitzung bleibt erhalten) und wird nie einfach deallocated; die App steuert Schlafen und Aufwecken selbst.

**Setup**

- Azure Virtual Desktop, persönlicher Host-Pool, direkte Zuweisung: jeder User hat seinen festen Session-Host.
- Entra-joined, Intune-verwaltet; RDP-Eigenschaft „Microsoft Entra Single Sign-On“; FSLogix nicht nötig.
- Image in der Azure Compute Gallery: SAP GUI, SNC bzw. Secure Login Client, Bot-Worker (Autostart bei Anmeldung in der User-Sitzung, nicht als Dienst in Session 0), Client-Scripting per Registry aktiv, Scripting-Hinweise abgeschaltet.
- Netzwerk: VNet mit Weg zu SAP (Site-to-Site, ExpressRoute oder Peering zu RISE); eigene KI im selben Netz. Der Worker baut nur ausgehende Verbindungen auf und meldet sich per Entra-Token (WAM) an.

**Aufwecken und Schlafen**

| VM-Zustand | Nach dem Start per API | Bot arbeitet? |
| --- | --- | --- |
| Hibernate | Sitzung des Users ist noch da | Ja, Worker verbindet sich neu |
| Deallocated / Neustart | Windows läuft ohne Sitzung des Users | Nein, User muss sich einmal anmelden |

1. Aufgabe kommt (Chat oder Routine); die App prüft VM-Zustand und Worker-Verbindung.
2. VM schläft: Die App startet sie über die Azure-API (Managed Identity, eigene Rolle nur mit `start` und `deallocate`/Hibernate auf der Ressourcengruppe des Pools).
3. Worker meldet sich: Aufgabe läuft. Kein Worker: Die App benachrichtigt den User (Teams oder Mail), sich einmal zu verbinden.
4. Nach der Aufgabe und einer Leerlaufzeit schickt die App die VM in den Ruhezustand, aber nur, wenn der User getrennt ist.
5. Bei Routinen weckt die App die VM vor dem geplanten Zeitpunkt.

Der AVD-Skalierungsplan bleibt nur Sicherheitsnetz (lange Wartezeit, Hibernate statt Deallocate), weil er nicht weiß, ob der Bot arbeitet.

**Nach dem Aufwachen**

- Die SAP-Verbindung ist meist weg; der Worker öffnet sie per Scripting (`OpenConnection`) neu, dank SSO ohne Passwort.
- Kerberos-Ticket bzw. SLC-Zertifikat müssen sich still erneuern; das ist der wichtigste Testpunkt.
- Bei gesperrtem Desktop arbeitet die Scripting API weiter, Screenshots nicht.

**Zuschauen und Übernehmen:** Verbindet sich der User mit seinem Desktop, ist er in derselben Sitzung und sieht den Bot live. Bewegt er Maus oder Tastatur, pausiert der Worker. Zuschauen ohne Verbindung: Bilderstream des Workers in der Web-App.

**Lebenszyklus**

- Onboarding: Entra-Gruppe → Automatisierung (Bicep/Terraform, AVD-API) legt Session-Host an und weist ihn zu.
- Offboarding: VM löschen, App-Daten und User-Schlüssel löschen.
- Updates nur in Wartungsfenstern; nach Neustart erkennt die App die fehlende Sitzung.

---

## 10. KI und Agent-Loop

Die eigene, selbst gehostete KI ersetzt OpenAI; dafür braucht es einen eigenen Agent-Loop, weil Bops fest auf die OpenAI Responses API und deren `computer`-Tool gebaut ist.

- **Schnittstelle:** OpenAI-kompatible Chat-API mit Tool-Calling (z. B. vLLM), damit Modelle austauschbar bleiben.
- **Tools statt Pixel:** SAP-Tools (Maske lesen, Feld setzen, Taste drücken, Tabelle lesen, Transaktion starten) liefern Text. Das senkt die Anforderungen an Bildverständnis und reduziert sensible Screenshots.
- **Screenshots nur als Fallback**, wenn das Modell Bilder kann.
- **Freigabe-Punkte im Loop:** Ein schreibendes Tool pausiert den Lauf, bis der User in der App zustimmt (Konzept aus Bops `permission.ts`).
- **Prompt-Logging** im KI-Server aus oder kurz befristet.
- Offen: welches Modell, Kontextlänge für lange SAP-Listen, Kapazität bei vielen gleichzeitigen Bots.

---

## 11. Audit und Protokollierung in SAP

Jede Änderung des Bots muss im SAP-System selbst als Bot-Aktion erkennbar sein und sich lückenlos bis zur Freigabe des Users zurückverfolgen lassen. Das SAP-Standardprotokoll allein reicht nicht, weil der Bot unter dem SAP-User der Person arbeitet und dort wie ein Mensch aussieht.

**Vier Ebenen, verbunden über eine Korrelations-ID pro Schreibaktion**

| Ebene | Was protokolliert wird | Wo |
| --- | --- | --- |
| 1. SAP-Standard | Änderungsbelege (CDHDR/CDPOS), Security Audit Log (Transaktionsstarts, RFC, Logons, Terminal; Konfiguration in RSAU_CONFIG, dynamische Filter pro User), Tabellenprotokoll für Customizing, Read Access Logging für sensible Daten | SAP, bestehende Aufbewahrung |
| 2. KI-Anwendungsprotokoll in SAP | Pro Schreibaktion: Korrelations-ID, User, Transaktion, Belegnummer, Feldwerte vorher/nachher, Zeitpunkt der Freigabe, freigebende Person | SAP Application Log (Funktionsbausteine `BAL_*`, Anzeige SLG1, Löschen SLG2; Objekt z. B. `ZKI_AUDIT`) über einen eigenen RFC-Baustein, berechtigungsgeschützt |
| 3. Kennzeichnung am Beleg | Hinweis „erstellt durch KI-Assistent, Freigabe-ID …“ im Kopftext bzw. Referenzfeld, wo der Prozess es zulässt | Am Beleg selbst |
| 4. Freigabe-Protokoll der App | Antrag des Bots, Freigabe oder Ablehnung, Ergebnis, Korrelations-ID; ohne Bildschirminhalte | Unveränderbarer Speicher (Azure Immutable Blob/WORM), Hash-Kette |

**Ablauf einer Schreibaktion**

1. Der Bot schlägt die Änderung vor; die App zeigt dem User die konkreten Werte und vergibt eine Korrelations-ID.
2. Der User gibt frei; bei kritischen Prozessen zusätzlich eine zweite Person (Vier-Augen-Prinzip).
3. Der Worker schreibt vor der Aktion einen Eintrag ins SAP Application Log („beabsichtigt“).
4. Der Worker führt die Aktion aus und liest das Ergebnis zurück (Belegnummer, Statusmeldung).
5. Der Worker schließt den Eintrag mit Ergebnis und Werten vorher/nachher ab; bei Fehlern wird das ebenfalls protokolliert.
6. App-Protokoll und SAP-Protokolle gehen per Korrelations-ID an das SIEM (z. B. Microsoft Sentinel oder SAP Enterprise Threat Detection).

**Regeln, damit Prüfer das System akzeptieren**

- Keine Schreibaktion ohne Eintrag: Schlägt das Protokollieren fehl, führt der Worker die Aktion nicht aus.
- Bot-Sitzungen sind erkennbar, z. B. über eigene Terminal-/Hostnamen der Bot-Computer im Security Audit Log, ergänzt um das Anfrage-Protokoll des Connectors beim Kunden; Option: separate Bot-Kennung pro Person (Lizenz- und SoD-Folgen prüfen).
- Schreiben bevorzugt über BAPI/OData statt GUI, wo möglich.
- Verfahrensdokumentation nach GoBD und Abstimmung mit interner Revision und Wirtschaftsprüfer vor dem Pilot.
- Lizenzfrage klären: SAP bewertet automatisierten Zugriff (RPA/Bots) lizenzrechtlich gesondert.
- Aufbewahrung der Audit-Daten bei buchungsrelevanten Aktionen nach GoBD (bis 10 Jahre); Inhalt bewusst knapp halten, damit es mit dem Löschkonzept vereinbar bleibt.

---

## 12. Datenschutz, Betriebsrat und Löschkonzept

Die bestehende KI-Betriebsvereinbarung für Chatbots wird um eine Anlage für dieses Tool erweitert. Unterschied zum Chatbot: Das Tool handelt in SAP und sieht Bildschirme; genau das regelt das Löschkonzept. Datenschutz bei der KI ist durch die eigene, selbst gehostete KI gelöst.

**Grundsätze**

1. Keine Leistungs- oder Verhaltenskontrolle (§87 Abs. 1 Nr. 6 BetrVG): Vorgesetzte sehen keine einzelnen Chats, Aufgaben oder Bildschirme.
2. Auswertungen nur anonym und aggregiert, Mindestgruppe 5 Personen, nur für Betrieb und Kosten.
3. Mitarbeitende sehen und löschen eigene Chats, Aufgaben und das Bot-Gedächtnis jederzeit.
4. Automatisches Löschen nach festen Fristen.
5. Audit-Protokoll nur anlassbezogen, Vier-Augen-Prinzip, mit Beteiligung des Betriebsrats.

**Fristen (Vorschlag, abzustimmen)**

| Daten | Frist | Zugriff |
| --- | --- | --- |
| Live-Bild beim Zuschauen | wird nicht gespeichert | nur der User |
| Screenshots im Aufgabenlauf | bei Aufgabenende, spätestens 24 h | niemand |
| Chats und Aufgabenverläufe | einstellbar, Standard 30 Tage, max. 90 | nur der User |
| Bot-Gedächtnis | bis der User löscht; sichtbar und editierbar | nur der User |
| Freigabe- und Audit-Protokoll (ohne Bildschirminhalte) | mind. 1 Jahr; buchungsrelevant nach GoBD bis 10 Jahre | anlassbezogen, Vier-Augen |
| Prompts im KI-Server | Logging aus oder max. 7 Tage | Betrieb, anlassbezogen |
| Technische Logs ohne Inhalte | 30 Tage | Betrieb |
| Lokale Dateien auf den Bot-Computern | Temp-Ordner regelmäßig leeren; bei Austritt löschen | – |

SAP-Belege und Änderungsbelege folgen weiter den bestehenden SAP-Aufbewahrungsregeln; Bot-Aktionen stehen dort unter dem User.

**Technische Umsetzung**

- Tägliche Löschjobs pro Datenkategorie.
- Crypto-Shredding: ein Schlüssel pro User im Azure Key Vault; Schlüssel löschen macht auch Backups unlesbar.
- Offboarding-Ereignis aus Entra löst Komplettlöschung aus: Daten, Gedächtnis, Schlüssel, ggf. Session-Host.
- Löschnachweis ohne Inhalte für die DSGVO-Rechenschaftspflicht.
- Aus Bops übernehmen: Aufbewahrungsfristen („Keep chats and calls“), „Recently deleted“, vertrauliche Nachrichten, User-Löschung. Nicht übernehmen: Bildschirmaufzeichnung (rrweb in `lib/server/mirror.ts`) und Bildschirmbeobachtung (`screen-watch.ts`).

---

## 13. Repo-Strategie

Empfehlung: ein eigenes Hauptrepo für das neue Produkt, in dem wir entwickeln; Bops bleibt nur Referenz. Ein Fork, der Upstream-Änderungen von Bops weiter übernimmt, lohnt sich nicht: Wir ersetzen genau die Kernteile (Orgo, OpenAI-Loop, Mac-App, Login), und jede Upstream-Änderung dort würde zu Konflikten führen.

| Variante | Vorteil | Nachteil |
| --- | --- | --- |
| **Eigenes Repo, Bops als Referenz (empfohlen)** | Saubere Struktur; keine Merge-Konflikte | Verbesserungen aus Bops nur gezielt von Hand übernehmen |
| Fork von Bops mit Upstream-Sync | Bops-Updates kommen automatisch | Ständige Konflikte in genau den Dateien, die wir umbauen; viel toter Mac/Orgo-Code |

**So arbeiten wir**

- Neues Monorepo: `web/` (Web-App), `worker/` (Agent auf den Bot-Computern), `connector/` (Connector fürs Kundennetz), `infra/` (Bot-Computer, Tunnel-Endpunkt, optional AVD), `docs/`.
- Bops als zweites Remote (`upstream`) oder als Ordner daneben, nur zum Nachlesen und gezielten Übernehmen einzelner Dateien.
- Übernommen werden gezielt: Chat-UI (`components/message-ui/`), Freigabe-Flow, Routinen, Löschlogik; jeweils mit Herkunftsvermerk.
- Klare Schnittstellen von Anfang an: `ComputerProvider` (Linux-VMs, Windows-VMs, optional AVD), `ModelProvider` (eigene KI), `SapChannel` (Fiori/WebGUI, OData/RFC, ADT, Scripting).
- Hinweis: Übernommener Bops-Code bleibt unter FSL; das wird mit der zurückgestellten Lizenzfrage geklärt.

---

## 14. Umsetzungsplan

Den Stand der Umsetzung und die Abnahmekriterien je Arbeitspaket dokumentiert der [Implementierungsplan](SAP-Bot-Implementierung.md). Die lokale Demo startet mit `npm run sap:demo`.

Zuerst kommt ein technischer Durchstich, der die größten Risiken prüft: Tunnel durch ein Kundennetz, Fiori im Bot-Browser mit SSO und der Login unter Conditional Access.

1. **Durchstich:** Connector mit Tailscale-Subnet-Router auf einem SAP-Testsystem, ein Linux-Bot-Computer mit Chrome, eigene KI, minimale Web-App mit Entra-Login. Ziel: Der Bot liest eine Fiori-App aus und füllt eine Maske nach Freigabe.
2. **Connector ausbauen:** HTTP-Proxy mit Pfad-Allowlist, Protokoll und Aus-Schalter beim Kunden; Installationspaket (VM-Image oder Container).
3. **SAP-Kanäle:** UI5-Tools für Fiori, WebGUI-Locators, SAP GUI for Java mit Scripting, RFC/OData für Buchungen, ARC-1 mit Login pro User.
4. **Plattform:** Chats, Routinen, Freigaben, Audit auf vier Ebenen inklusive SAP-Protokoll, Löschjobs, Live-Ansicht und Übernahme.
5. **Windows-Ausnahme:** Windows-VMs mit SAP GUI Scripting für Transaktionen ohne anderen Weg.
6. **Pilot** mit einer kleinen Gruppe; Betriebsvereinbarung, AVV und Freigabe der Kunden-Security abgeschlossen.

**Testplan für den Durchstich**

- [ ] Tunnel baut sich aus einem Kundennetz mit Proxy bzw. TLS-Inspection auf (Fallback über 443/TCP).
- [ ] Fiori Launchpad lädt im Bot-Browser: Split-DNS, interne CA, alle Hosts in der Allowlist.
- [ ] SAML-SSO mit Entra ID funktioniert im Bot-Browser; Verhalten unter Conditional Access und MFA ist geklärt.
- [ ] Der Bot liest den UI5-Control-Baum und führt eine Aktion zuverlässig aus.
- [ ] SAP GUI for Java mit Scripting lässt sich auf Linux von außen steuern.
- [ ] Eine Schreibaktion erzeugt alle vier Audit-Einträge mit derselben Korrelations-ID.
- [ ] ARC-1 liest und ändert ein Objekt in einem erlaubten Paket über den Connector.
- [ ] Eigene KI bedient die Tools zuverlässig (Tool-Calling, lange Listen).

---

## 15. Geprüfte und verworfene Optionen

| Option | Ergebnis | Begründung |
| --- | --- | --- |
| Bops lokal auf Windows portieren (Mac-Pfad mit Codex/Sandbox) | Verworfen als Hauptweg | Größter Umbau (Sandbox ohne Windows-Gegenstück), passt nicht zur Zielgruppe Kundenmitarbeitende |
| Bot nutzt das VPN des Kunden über einen VPN-Client auf Windows | Verworfen | Device-Posture-Checks, persönliche VPN-Accounts, MFA bei jeder Sitzung, Full-Tunnel-Probleme, schlecht skalierbar |
| „Route through this Mac“ (`relay.ts`) ins VPN | Verworfen | Privater Orgo-Relay-Agent, in Produktion nicht freigeschaltet, aus Compliance-Sicht nicht vertretbar |
| BTP + SAP Cloud Connector | Ergänzung, nicht Hauptweg | Cloud Connector verbindet nur mit BTP; sinnvoll, wenn der Kunde BTP hat (z. B. ARC-1 oder OData-MCP auf BTP mit Principal Propagation); RFC über BTP braucht Java (JCo) |
| AVD-Cloud-PCs im Kunden-Tenant | Alternative | Gut für SAP GUI Scripting und Kerberos, aber der Kunde muss Cloud-PCs betreiben (nicht gewünscht) |
| SAP GUI for Windows unter Wine | Verworfen | Nicht unterstützt, unzuverlässig |
| Eigener Connector + Linux-Bot-Computer | **Gewählt** | Kunde installiert nur den Connector; passt zur Bops-Architektur (Linux-VMs, Chrome, Playwright, Tailscale) |

---

## 16. Lokaler Test von Bops unter Windows (2026-11-09)

- `npm ci` erfolgreich (Node 24.12.0).
- `npx next dev --port 3210 -H 127.0.0.1` startet; `/api/health` und Startseite antworten mit 200; die Anmeldeseite wird angezeigt. Warnungen zu Edge-Runtime in `instrumentation.ts` sind harmlos.
- **Anmeldung:** „Sign in with Google/Orgo“ speichert den Key in der macOS-Keychain und scheitert unter Windows. Workaround: Self-hosted-Modus mit `OPENAI_API_KEY`, `OPENAI_EXECUTOR_API_KEY`, `ORGO_API_KEY` in `.env.local` (aus `.env.example` angelegt, Keys noch leer).
- **Electron-App** startet unter Windows nicht ohne Anpassungen: `desktop/main.cjs` nutzt `spawn("npx")` ohne Shell (`npx.cmd`), `/bin/zsh` und `/bin/sh`.

---

## 17. Faktencheck gegen die SAP-Dokumentation

Die meisten SAP-Aussagen dieses Konzepts sind gegen die offizielle Dokumentation geprüft und bestätigt; zwei Korrekturen ändern die Bewertung.

| Aussage | Ergebnis | Quelle |
| --- | --- | --- |
| SAP GUI Scripting gibt es nur unter Windows | **Korrigiert:** Scripting gibt es für SAP GUI for Windows und Java; SAP GUI for Java hat eine eingebaute JavaScript-Engine und Optionen für externe Skripte; läuft unter Windows, macOS und Linux | [SAP GUI Scripting](https://help.sap.com/docs/SUPPORT_CONTENT/atopics/3354081614.html), [SAP GUI for Java](https://help.sap.com/docs/sap_gui_for_java/e665f2b67dbd4328ab6bd9e029b84581/fc47e854e41a41eda017c7c112bdbeaf.html?version=780.03) |
| ABAP im Browser nur über Community-Extension | **Korrigiert:** offizielle ABAP Development Tools für VS Code (ABAP Cloud, Backends ab S/4HANA 1909, MCP-Agentenfunktionen, teils lizenzpflichtig) | [Tools Overview](https://help.sap.com/docs/ABAP_Cloud/49f2f38ba2bd4f1cb8e0fd76d5a5f0d7/86f387135f7c4f548e6457f4cde06a43.html), [Roadmap](https://help.sap.com/docs/ABAP_PLATFORM_CROSS/f2afdaf444844c38909aefc7bc792cdb/e9f4167cd4f94f7da072fc8676c4112f.html) |
| WebGUI über integrierten ITS, SICF-Service `webgui` | **Bestätigt** | [Installation and Activation](https://help.sap.com/docs/ABAP_PLATFORM_NEW/b97ada5a7a6a4ad190a524c603b8e570/d1c010923c664f8c9e5764f6cdaa6ca9.html) |
| WebGUI hat Einschränkungen, SAP-Hinweis 314568 | **Bestätigt**, zusätzlich: keine Mehrfachsitzungen, kein Drag and Drop, keine SAP-Shortcuts | [SAP GUI for HTML](https://help.sap.com/docs/SAP_NETWEAVER_701/6d9ce8796c4b1014910cfd067e19ab5c/4daeae42cd7fb611e10000000a155106.html) |
| GUI-Unterstützung pro Transaktion in SE93 | **Bestätigt** | [User Interface](https://help.sap.com/docs/ABAP_PLATFORM_NEW/bd833c8355f34e96a6e83096b38bf192/2618008ad17f43f48c68a13b1cdde86f.html) |
| Scripting serverseitig über `sapgui/user_scripting` | **Bestätigt**, plus `…_set_readonly` und `…_disable_recording` | [Security for SAP GUI Scripting](https://help.sap.com/docs/ABAP_PLATFORM_NEW/1e4f30c2cbfd4ba5bc7f5d56f3ca5117/4938dea6c657200be10000000a42189c.html), [Modes for Server Side Protection](https://help.sap.com/docs/sap_gui_for_windows/1f190e2f59db43e192cba638ea29870b/68e329a92e4b454ba74cb196b614bc0a.html) |
| Scripting-Hinweisdialoge abschaltbar | **Bestätigt** | [Scripting (SAP GUI for Windows)](https://help.sap.com/docs/sap_gui_for_windows/63bd20104af84112973ad59590645513/7ddb7c9c4a4c43219a65eee4ca8db001.html) |
| Security Audit Log mit Filtern pro User | **Bestätigt** (RSAU_CONFIG) | [Example Filters](https://help.sap.com/docs/ABAP_PLATFORM_NEW/025d1fb2f02c42c097f04f45df09106a/6c57bf393b57ac22e10000000a11402f.html) |
| Application Log für eigenes KI-Protokoll | **Bestätigt** (`BAL_*`, SLG1, SLG2) | [Application Log](https://help.sap.com/docs/ABAP_PLATFORM_NEW/addb96cd90c945dfb3182865363bbc47/4e23ac220771417fe10000000a15822b.html) |
| Secure Login Service: X.509 ohne eigene PKI, SAML | **Bestätigt** | [Authentication and SSO](https://help.sap.com/docs/SAP_BUSINESS_CLIENT/f526c7c14c074e7b9d18c4fd0c88c593/c9567d6a739a4b4f97abdf26d021711e.html) |
| SAML für Fiori/Gateway | **Bestätigt** mit Voraussetzungen | [Configuring SAML for SAP Gateway](https://help.sap.com/docs/ABAP_PLATFORM_NEW/68bf513362174d54b58cddec28794093/925c22518bc72214e10000000a44176d.html) |
| SAP Cloud Connector nur für BTP | **Bestätigt**; Protokolle HTTP, RFC, LDAP, TCP (SOCKS5) | [Configure Access Control](https://help.sap.com/docs/CP_CONNECTIVITY/cca91383641e40ffbe03bdc78f00f681/f42fe4471d6a4a5fb09b7f3bb83c66a4.html), [TCP Protocol](https://help.sap.com/docs/CP_CONNECTIVITY/b865ed651e414196b39f8922db2122c7/c2461c31761b488c828e15b71263f3fd.html) |
| SAProuter mit Route-Strings | **Bestätigt** | [RI Configuration of SAProuter](https://help.sap.com/docs/SAP_NETWEAVER_731_BW_ABAP/af8bcf35778c4d098ba482cc0b59f339/46d37efee5343c1de10000000a155369.html) |
| `rdisp/gui_auto_logout` meldet inaktive Sitzungen ab | **Bestätigt** | [Support Content](https://help.sap.com/docs/SUPPORT_CONTENT/si/3362959186.html) |
| ECC-Wartung bis 2027, erweitert bis 2030 | **Präzisiert:** nur EHP6 bis EHP8; Quelle Fachpresse | [The Register](https://www.theregister.com/2025/01/28/sap_extends_support_deadline/), [SAPinsider](https://sapinsider.org/blogs/sap-support-deadlines-2027-2030-2033/) |
| SAML ab Basis 7.02, ADT-Mindestrelease für ECC | **Nicht bestätigt**; im Kundenprojekt prüfen | – |

---

## 18. Markt und SAP-API-Policy

Einen Anbieter mit genau unserem Zuschnitt (Bot pro Mitarbeiter mit eigenem Computer, SAP-spezifisch, als der User, Audit in SAP, Connector ohne Kunden-Infrastruktur) haben wir nicht gefunden; Microsoft und UiPath bewegen sich aber darauf zu. Größeres Risiko als die Konkurrenz ist SAPs API-Policy von 2026.

**Marktüberblick (Stand 2026-11-09)**

| Anbieter | Ansatz | Unterschied zu uns |
| --- | --- | --- |
| Microsoft Copilot Studio „Computer Use“ | Agenten bedienen Web- und Desktop-Apps per Klick; SAP-Beispiel (Kundenaufträge aus CSV) auf Windows 365 ([Deck](https://adoption.microsoft.com/files/microsoft-365-community-conference/2026/pdf/MS56%20-%20Supercharge%20Your%20Agents%20with%20Computer%20Use%20in%20Copilot%20Studio.pdf), [Ankündigung](https://www.microsoft.com/microsoft-copilot/blog/copilot-studio/announcing-computer-use-microsoft-copilot-studio-ui-automation/)) | Nächster Konkurrent; pixelbasiert, generisch, kein Audit in SAP, kein Connector. Drittanbieter-Schätzung: ca. 96 $/Tag für einen SAP-GUI-Flow mit 50 Schritten und 200 Läufen ([Blog](https://www.digitalapplied.com/blog/copilot-studio-computer-use-agents-ga-deep-dive)) |
| SAP Joule / Joule Agents | SAPs eigene Agenten-Schicht auf API-Ebene ([CIO](https://www.cio.com/article/4231331/sap-advances-its-autonomous-ai-agenda-with-yet-more-joule-assistants-and-agents.html), [TechTarget](https://www.techtarget.com/searcherp/news/366642871/SAP-unveils-agentic-AI-tools-to-partially-automate-ERP-suite)) | Stark bei S/4HANA-Standardprozessen; schwach bei ECC, Z-Transaktionen, SAP GUI; BTP-/Joule-Lizenzen |
| UiPath | RPA für SAP GUI, WebGUI, Fiori; „UI Agent for Computer Use“ in Private Preview ([e3mag](https://e3mag.com/en/equal-rights-for-ki-agents/), [UiPath SAP](https://www.uipath.com/ko/solutions/technology/sap-automation)) | Prozesse baut ein Entwickler; kein Bot pro Mitarbeiter im Chat |
| SAP Build Process Automation, Automation Anywhere, Power Automate Desktop | RPA mit SAP-GUI-Unterstützung | Deterministische Abläufe statt Assistent |
| Generische Computer-Use-Agenten (H Company, OpenAI, Anthropic, Orgo/Bops) | Bedienen jede Oberfläche ([H Company](https://en.wikipedia.org/wiki/H_(company))) | Nicht SAP-spezifisch: kein Audit, keine Freigaben, kein SSO als User |
| Nischenanbieter (z. B. NeKu AI) | Chatbot in Fiori und SAP GUI ([NeKu](https://neku.ai/en/sap-fiori-chatbot/)) | Hilft dem Menschen, bedient nicht selbst |

Unsere Differenzierung: SAP-Tiefe (Scripting, Fiori-Control-Baum, ARC-1, Audit in SAP), ECC-Unterstützung, eigene KI, Connector ohne Kunden-Infrastruktur.

**SAP API Policy v4/2026, Abschnitt 2.2.2**

Laut Fachpresse und Analysten verbietet die Klausel, SAP-APIs für KI-Systeme zu nutzen, die API-Aufrufe planen oder ausführen, außer über von SAP freigegebene Wege (Joule/A2A, Business Data Cloud, Agent Gateway, APIs im Business Accelerator Hub). Dieselbe Klausel verbietet Scraping und systematische oder großvolumige Datenextraktion. Deterministische RPA soll laut einer Analyse nicht betroffen sein (FAQ Q40, nicht selbst geprüft). Zur Bedienung der Oberfläche durch KI-Agenten sagt keine Quelle etwas Eindeutiges; die DSAG kritisiert die unklare Abgrenzung. Quellen: [Techzine](https://www.techzine.eu/blogs/applications/141323/sap-blocks-external-ai-agents-salesforce-and-servicenow-dont/), [Forrester](https://www.forrester.com/blogs/sap-is-attempting-to-become-the-gatekeeper-of-enterprise-ai-cios-should-push-back/), [Kai Waehner](https://www.kai-waehner.de/blog/2026/05/02/data-ownership-in-the-age-of-agentic-ai-why-saps-api-policy-forces-a-data-integration-reckoning-for-every-enterprise/), [zeis.de](https://blog.zeis.de/posts/2026-06-01-mcp-api-policy/), [shubhendu.ai](https://shubhendu.ai/blog/sap-api-policy-architecture-spec), [SAP Community](https://community.sap.com/t5/technology-blog-posts-by-members/sap-s-new-api-policy-is-quietly-rewriting-the-bw-roadmap/ba-p/14441607), [Technology Magazine](https://technologymagazine.com/news/can-ai-agents-still-access-sap-data-under-new-api-rules).

| Kanal | Ruft die KI selbst eine API auf? | Einschätzung zur Policy |
| --- | --- | --- |
| OData, RFC/BAPI, ADT (ARC-1) | Ja, direkt | Am stärksten betroffen |
| Fiori im Browser | Nein; die App ruft OData auf | Grauzone |
| SAP GUI Scripting | Client-Automatisierung, von SAP „Scripting API“ genannt | Grauzone |
| WebGUI, SAP GUI per Bildschirm | Nein; wie ein Mensch | Am wenigsten angreifbar; Scraping-Verbot bei großen Datenmengen beachten |

Einschätzung, keine Rechtsauskunft; ob und wie die Policy für On-Premise-Systeme (ECC, S/4HANA On-Premise) gilt, hängt vom Kundenvertrag ab.

**Maßnahmen**

1. Policy-Text und FAQ von SAP besorgen und rechtlich prüfen lassen, ggf. mit SAP-Lizenzmanagement und DSAG; vor dem Pilot.
2. Kanäle trennbar bauen (`SapChannel`): Ist der API-Weg nicht zulässig, bleibt der Bot bei der Oberfläche; für Kunden mit Joule zusätzlich eine Anbindung über A2A an Joule.
3. Mengen begrenzen: keine Massenexporte über die Oberfläche, damit das Scraping-Verbot nicht greift.

---

## 19. Risiken und offene Fragen

Die größten Risiken sind SAPs API-Policy für KI-Agenten, die Freigabe des Connectors durch die Kunden-Security und der Login unter Conditional Access.

| Risiko | Folge | Gegenmaßnahme |
| --- | --- | --- |
| SAP API Policy v4/2026 (§2.2.2) verbietet KI-gesteuerte API-Aufrufe | OData-, RFC- und ADT-Kanäle ggf. unzulässig; Scraping-Verbot | Rechtsprüfung vor Pilot; Kanäle trennbar, Oberfläche als Hauptweg, A2A zu Joule; Mengen begrenzen |
| Kunden-Security lehnt den Connector ab | Kein Zugang ins Kundennetz | Pfad-Allowlist, Protokoll, Aus-Schalter, DMZ; sonst AVD-Alternative |
| Conditional Access blockiert den Bot-Browser | Bot braucht häufig den User zum Login | X.509 über Secure Login Service, IP-Ausnahme, Login in der Live-Ansicht |
| Proxy bzw. TLS-Inspection stört den Tunnel | Verbindung bricht ab | Fallback über 443/TCP, Abstimmung mit Netzwerkteam |
| Transaktion läuft nicht in WebGUI/Fiori | Lücke im Browser-Weg | SAP GUI for Java, RFC/OData oder Windows-VM |
| Ältere ECC-Stände | WebGUI oder SAML fehlen | Release früh prüfen; Einzelfall |
| Eigene KI zu schwach für Tool-Calling | Fehlbedienung, Abbrüche | Modellauswahl testen, strenge Freigaben |
| SAP-Lizenz für automatisierten Zugriff | Nachlizenzierung | Früh mit SAP-Lizenzmanagement klären |
| Wettbewerb (Microsoft, UiPath, SAP Joule) | Kunde wählt Plattformanbieter | SAP-Tiefe, ECC, Audit in SAP, eigene KI als Differenzierung |
| Lizenzen Bops (FSL) und ARC-1 | Einschränkung bei Produkt bzw. Betrieb | Vor Rollout rechtlich klären |

**Offene Fragen an den Kunden**

- [ ] Welche SAP-Verträge gelten, und fällt der Kunde unter die API Policy v4/2026? Nutzt er Joule?
- [ ] Darf ein Connector ins SAP-Netz (DMZ, Freigabeprozess der Security)?
- [ ] SAP-Release und EHP-Stand; S/4HANA oder ECC? Ist der Service `webgui` aktiv?
- [ ] Gibt es SAML-SSO für Fiori mit Entra ID? Welche Conditional-Access-Regeln gelten?
- [ ] Gibt es SAP IAS bzw. den Secure Login Service?
- [ ] Ist SAP GUI Scripting erlaubt (RZ11 `sapgui/user_scripting`)?
- [ ] Welche Transaktionen und Prozesse zuerst? Laufen sie in Fiori/WebGUI?
- [ ] Welche eigene KI (Modell, Hosting, Kapazität)?
- [ ] Gibt es eine KI-Betriebsvereinbarung, an die wir anschließen?

---

## 20. Quellen (außer SAP-Doku aus Abschnitt 17 und Markt/Policy aus Abschnitt 18)

- [mcp-sap-gui (kts982)](https://images.glama.ai/mcp/servers/kts982/mcp-sap-gui)
- [KTern sapguimcp (PyPI)](https://pypi.org/project/ktern-sapguimcp/1.0.2/)
- [sapient-mcp (PyPI)](https://pypi.org/project/sapient-mcp/)
- [Playwright-SAP](https://www.playwright-sap.dev) · [FAQ](https://playwright-sap.dev/FAQs)
- [ARC-1](https://glama.ai/mcp/servers/r9w4rmjswa)
- [btp-sap-odata-to-mcp-server (lemaiwo)](https://glama.ai/mcp/servers/@lemaiwo/btp-sap-odata-to-mcp-server/blob/568fc619f2108cde7b09faf343392c7cc5dab3e5/docs/DEPLOYMENT.md)
- [UiPath SAP WebGUI](https://docs.uipath.com/studio/standalone/latest/user-guide/about-sap-webgui-automation)
