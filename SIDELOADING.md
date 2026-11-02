# Pianooo installieren – iPad (Sideloading) und Mac

Pianooo ist nicht im App Store. Du installierst die App selbst mit deiner
eigenen Apple-ID – das nennt sich „Sideloading“ und ist von Apple vorgesehen
(für eigene Apps und Entwickler). Du brauchst dafür **einmal einen Computer**
(Windows oder Mac) und ein **USB-Kabel** fürs iPad.

**Download der App:**
https://github.com/HOAI-droid/Pianooo/releases/download/ipad-latest/Pianooo.ipa

Lade die Datei auf dem **Computer** herunter, nicht auf dem iPad.

---

## Weg 1: Sideloadly (empfohlen, Windows und Mac)

1. **Sideloadly installieren:** https://sideloadly.io → Download für Windows oder Mac.
   - **Windows:** Zusätzlich **iTunes** und **iCloud** installieren – und zwar
     die Versionen **direkt von apple.com** (nicht aus dem Microsoft Store).
     Sideloadly zeigt beim Start die passenden Links an.
2. **iPad anschließen:** per USB-Kabel. Auf dem iPad „Diesem Computer vertrauen?“
   → **Vertrauen** und Code eingeben.
3. **Sideloadly öffnen:**
   - Oben sollte dein iPad erscheinen.
   - `Pianooo.ipa` in das Fenster ziehen (oder auf das IPA-Symbol klicken).
   - Bei **Apple account** deine Apple-ID eintragen (eine normale, kostenlose
     Apple-ID reicht; gern eine zweite Apple-ID nur dafür).
   - **Start** klicken, Passwort eingeben (und ggf. den Code der
     Zwei-Faktor-Anmeldung).
4. Nach „Done“ ist Pianooo auf dem iPad. Bevor sie startet, noch zwei Schritte
   auf dem iPad:
   - **Entwicklermodus einschalten** (einmalig, iPadOS 16 und neuer):
     Einstellungen › Datenschutz & Sicherheit › **Entwicklermodus** → an →
     iPad neu starten → nach dem Neustart „Einschalten“ bestätigen.
   - **Profil vertrauen:** Einstellungen › Allgemein › **VPN und Geräteverwaltung**
     › deine Apple-ID antippen › **Vertrauen**.
5. Pianooo starten. Fertig.

### Alle 7 Tage erneuern (kostenlose Apple-ID)

Mit einer kostenlosen Apple-ID läuft die App **7 Tage**, danach startet sie nicht
mehr, bis du sie neu signierst. Deine Songs und Einstellungen bleiben erhalten.

- **Einfach:** iPad anschließen, in Sideloadly nochmal **Start** – fertig.
- **Automatisch:** In Sideloadly bei der App **„Automatic refresh“**
  einschalten. Dann erneuert Sideloadly die App selbst, sobald Computer und iPad
  im selben WLAN sind und Sideloadly läuft.

Mit einem **kostenpflichtigen Apple-Developer-Konto** (99 €/Jahr) gilt die
Signatur 1 Jahr, und TestFlight wird möglich.

---

## Weg 2: AltStore (Windows und Mac)

1. **AltServer** auf dem Computer installieren: https://altstore.io (AltStore Classic).
   Windows: wie oben iTunes und iCloud von apple.com.
2. iPad per USB anschließen, im AltServer-Menü (Taskleiste / Menüleiste)
   **Install AltStore** › dein iPad wählen › Apple-ID eingeben.
3. Auf dem iPad: Entwicklermodus und Profil vertrauen (wie oben, Schritt 4).
4. `Pianooo.ipa` aufs iPad bringen (z. B. per AirDrop oder in iCloud Drive
   ablegen), dann in **AltStore › My Apps › +** die Datei auswählen.
5. AltStore erneuert die App automatisch alle paar Tage, solange AltServer auf
   dem Computer läuft und beide im selben WLAN sind.

---

## Weg 3: Xcode (Mac, aus dem Quellcode)

Wer einen Mac hat, kann Pianooo direkt aus dem Code installieren – siehe
[IPAD.md](IPAD.md), Abschnitt „Variante A“.

---

## Mac

Pianooo gibt es auch als Mac-App – dieselbe App wie auf dem iPad, im
Mac-Fenster und mit Maus (läuft auf Apple-Silicon- und Intel-Macs, ab macOS 12).

**Download:**
https://github.com/HOAI-droid/Pianooo/releases/download/ipad-latest/Pianooo-Mac.zip

1. Zip-Datei öffnen (Doppelklick) → **Pianooo** in den Ordner **Programme** ziehen.
2. Die App ist nicht von Apple beglaubigt (kein Entwicklerkonto). Beim ersten
   Start blockiert macOS sie deshalb:
   - Pianooo einmal per Doppelklick starten → Meldung mit **Fertig** schließen.
   - **Systemeinstellungen › Datenschutz & Sicherheit** › ganz unten bei
     „Pianooo wurde blockiert“ auf **Trotzdem öffnen** klicken, mit Passwort
     bestätigen.
   - Alternativ im Terminal: `xattr -cr /Applications/Pianooo.app`
3. Danach startet Pianooo normal. Keine 7-Tage-Grenze auf dem Mac.

**Songs hinzufügen:** MIDI/MusicXML-Datei auf das Pianooo-Fenster ziehen, über
den Öffnen-Knopf wählen oder im Finder per Rechtsklick › Öffnen mit › Pianooo.
Die Bibliothek liegt im App-Container
(`~/Library/Containers/maccatalyst.com.hoaidroid.pianooo/Data/Documents`).

**Kawai ES120 am Mac:** Wie auf dem iPad über *MIDI › Connect Bluetooth
keyboard…* – oder per USB-Kabel, dann erscheint es sofort.

---

## Häufige Probleme

| Problem | Lösung |
|---|---|
| „Nicht vertrauenswürdiger Entwickler“ | Einstellungen › Allgemein › VPN und Geräteverwaltung › Apple-ID › Vertrauen |
| App startet nicht mehr nach einer Woche | 7-Tage-Grenze: in Sideloadly/AltStore neu signieren |
| Sideloadly findet das iPad nicht (Windows) | iTunes von apple.com (nicht Microsoft Store) installieren, Kabel neu einstecken, „Vertrauen“ bestätigen |
| „Maximum number of apps“ | Kostenlose Apple-ID: max. 3 selbst installierte Apps gleichzeitig – eine andere entfernen |
| Fehler bei der Anmeldung | Für Sideloading eine eigene, zweite Apple-ID verwenden; ggf. ein app-spezifisches Passwort unter account.apple.com erstellen |

## Updates

Jede Änderung auf `main` baut automatisch eine neue `Pianooo.ipa` unter
demselben Link. Neue Version einfach wie oben mit Sideloadly/AltStore
installieren – sie ersetzt die alte, deine Songs bleiben.
