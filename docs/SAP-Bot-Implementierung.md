# SAP GrokBot – Umsetzung und Arbeitspakete

## Lokalen Prototyp starten

Voraussetzungen sind Node.js 24, installierte Repo-Abhängigkeiten (`npm ci`) und ein Chromium-Browser. `npx playwright install chromium` installiert den Playwright-Browser. Falls der fehlt, probiert die Demo unter Windows Edge am üblichen Installationspfad. `SAP_DEMO_BROWSER` setzt den Pfad zur gewünschten ausführbaren Browserdatei.

```powershell
npm run sap:demo
npm run sap:test
npm run sap:test:browser
```

Die UI ist eine Next.js-Route unter [127.0.0.1:3211/sap](http://127.0.0.1:3211/sap) und wiederverwendet die Bops-Oberfläche (Sidebar, Chat, Computer-Panel, Freigabe-Karten). Der Port lässt sich über `SAP_DEMO_PORT` ändern. Next und die SAP-API lauschen auf Loopback. Backend bleibt `sap-grokbot` (Worker/Session/Computer) hinter `/api/sap/*`. Der Prototyp verwendet synthetische Daten, eine lokale Demo-Sitzung und einen separaten Headless-Browser. Freigabeprotokoll sitzt als Drawer im Chat.

**Integrationswahl:** Eigene Route `/sap` + `/api/sap/*` statt den gesamten `BopsApp`-State zu faken. So bleiben Origin-Checks, Freigabe-Bindung, Audit und `SAP_AUTH_MODE` im SAP-Backend, während Look-and-Feel aus den Bops-Komponenten kommt. Ob übernommener Bops-UI-Code unter FSL für den SAP-Einsatz freigegeben ist, entscheidet der Owner.

Ein echtes `SAP_BROWSER_TARGET` verlangt standardmäßig den Entra-Cloud-Modus (`SAP_APP_ORIGIN`, `SAP_PROXY_SECRET`, `SAP_ENTRA_GROUP`, Identity-Header). Für Einzelplatz-Tests ohne OAuth2 Proxy setzt man explizit `SAP_AUTH_MODE=none` zusammen mit `SAP_AUDIT_FILE`, `SAP_USER_MAP` und optional `SAP_LOCAL_ACTOR` (Standard `local-test`). Details und Beispielvariablen stehen in [SAP-Bot-Betrieb.md](SAP-Bot-Betrieb.md). `npm run sap:demo:api` startet weiterhin nur den Node-API-Server.

### Ablauf zum Ausprobieren

1. **Notiz lesen** zeigt den gespeicherten Text des Testauftrags.
2. **Notiz ändern: Lieferung bestätigt** erzeugt einen Vorschlag mit altem und neuem Wert.
3. **Ablehnen** verwirft den Vorschlag. **Freigeben und speichern** schreibt den angezeigten Wert und liest ihn zur Bestätigung zurück. Das Freigabeprotokoll zeigt die zusammengehörigen Ereignisse unter derselben ID.
4. **Übernehmen** wechselt in den manuellen Modus und verwirft eine offene Freigabe. Klicke in der Live-Ansicht auf das Notizfeld und sende über das Textfeld eine Eingabe an den Bot-Browser. **An Bot zurückgeben** schaltet den Chat wieder frei.

Der Chat erkennt die zwei dokumentierten Aufträge per Regeln. Optional kann Freitext über mehrere konfigurierte Modellprofile verarbeitet werden. Für die lokale Demo sind keine Schlüssel nötig. Die manuelle Bedienung steuert die Testmaske direkt. Das Freigabeprotokoll erfasst Änderungen, die der Bot vorschlägt und ausführt.

Mit `npm run sap:test` laufen die Tests für Freigaben, Modellprofile, Connector-Regeln, Auth-Modus und getrennte Cloud-Sitzungen ohne Browser oder externe Verbindungen. `npm run sap:test:browser` prüft Live-Bild, Freigabe und manuelle Eingabe mit Playwright Chromium.

## Arbeitspakete

| Paket | Status | Ergebnis und Abnahme | Abhängigkeiten |
| --- | --- | --- | --- |
| **AP 00 – Projektstruktur** | Umgesetzt | Prototyp in `sap-grokbot/`, getrennt vom Bops-Startpfad. Vor Produktentwicklung Zielrepo und Lizenz für gegebenenfalls übernommenen Bops-Code klären. | — |
| **AP 01 – Sichtbarer Bot-Browser** | Lokal umgesetzt | Eigene Browser-Instanz mit synthetischer Maske, Live-Bild, Übernahme und Rückgabe. Im manuellen Modus blockiert der Server Bot-Aufträge. | AP 00 |
| **AP 02 – Auftrag, Freigabe und Protokoll** | Lokal umgesetzt | Notiz lesen und ändern. Der Server bindet die Freigabe an einen konkreten Vorschlag und verbraucht sie einmalig. Rücklesen bestätigt das Ergebnis. | AP 01 |
| **AP 03 – Modellanbieter** | Implementiert, mit Testantwort geprüft | Modellauswahl und serverseitige Schlüssel für mehrere Chat-Completions-Profile. Freigabe bleibt im Worker. Live-Aufrufe an die vorgesehenen Anbieter stehen aus. | Freigegebene Modellendpunkte |
| **AP 04 – Connector** | Implementiert, im Kundennetz offen | HTTPS-Proxy mit erlaubten Methoden und Pfaden, festem Upstream, Weiterleitungsprüfung und systemd-Dienst. Tailscale Serve verbindet die Cloud-VM privat mit dem Kundenhost. | SAP Basis, Netzwerk, Kunden-Security |
| **AP 05 – Persönliche Anmeldung und Bot-VM** | Cloud-Konfiguration vorhanden, Entra-Abnahme offen | Caddy und OAuth2 Proxy für Entra. Getrennte Browserprozesse pro Person auf einer Linux-VM je Kunde. SAP-SSO und Conditional Access im Tenant prüfen. Separate VM pro Person ist offen. | Entra-Testtenant, Pilotgruppe und Cloud-VM |
| **AP 06 – SAP-Durchstich** | Browseradapter vorhanden, SAP-Abnahme offen | Konfigurierbare Testmaske, Prüfung von Konto und Datensatz, Schreiben nur bei Freigabe und Rücklesen. Selektoren, SSO und den tatsächlichen Speicherpfad am konkreten SAP-Prozess prüfen. | AP 04–05, Prozess und Zugriffsweg freigegeben |
| **AP 07 – Pilotbetrieb** | Teilweise umgesetzt | Persistentes App-Audit auf der Cloud-VM und Prüfung der Pilotgruppe. Revisionssicheres externes Audit, SAP-Protokoll, Aufbewahrung, Löschung und Pilotfreigabe sind offen. | AP 06, Kundenanforderungen |
| **AP 08 – Weitere SAP-Kanäle** | Nach dem Durchstich | RFC/OData, ARC-1 und SAP GUI for Java je nach Bedarf und Freigabe. Windows-VM oder AVD bei einem konkret nachgewiesenen Bedarf evaluieren. | AP 06, fachliche und vertragliche Freigaben |

**Als Nächstes** kann die authentifizierte Cloud-App zunächst mit der Testmaske abgenommen werden. Danach folgen der Connector-Test und der erste echte SAP-Lesevorgang. Einrichtung, Konfiguration und Abnahmeschritte stehen in [SAP-Bot-Betrieb.md](SAP-Bot-Betrieb.md).

## Module im Prototyp

| Modul | Verantwortung |
| --- | --- |
| `app/sap/`, `components/sap/`, `app/api/sap/` | Bops-ähnliche UI (Next) und API-Bridge zum SAP-Backend |
| `sap-grokbot/web/` | HTTP-Backend, Herkunftsprüfung, Cloud-Sitzungen, Legacy-Hinweisseite |
| `sap-grokbot/worker/session.mjs` | Bedienmodus, begrenzte Aufträge, Freigaben, serieller Zugriff und Protokoll |
| `sap-grokbot/worker/computer.mjs` | Playwright-Browser, Bild, manuelle Eingabe und konfigurierbarer SAP-Browseradapter |
| `sap-grokbot/worker/models.mjs` | Modellprofile mit begrenzten Werkzeugen |
| `sap-grokbot/connector/` und `sap-grokbot/deploy/` | HTTPS-Connector, Cloud-Konfiguration und systemd-Dienste |
| `sap-grokbot/test/demo.test.mjs` | HTTP-Tests mit Testadapter für Freigaben und Übernahme. Separater End-to-End-Test mit Browser für Live-Bild, Freigabe und manuelle Eingabe. |

Die Demo gibt bei einem Fehler nach der Freigabe ein ungeklärtes Ergebnis aus. Sie wiederholt die Schreibaktion nicht automatisch. Für echte SAP-Änderungen müssen AP 06 und AP 07 das Wiederanlaufverhalten, den Abgleich mit SAP und das dauerhafte Audit abdecken.
