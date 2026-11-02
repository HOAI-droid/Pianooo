# Pianooo für das iPad – Details

Pianooo basiert auf [Orfeo](https://github.com/Squarebow/Orfeo) (GPLv3, von SquareBow) und ist dessen
iPad-App. Die Oberfläche und die Lern-Funktionen sind dieselben wie in der
Desktop-Version; neu sind:

- **iPad-App** (Capacitor): läuft im Vollbild, Querformat und Hochformat
- **Bedienung per Finger**: Tippen, Ziehen (Regler, Loop, Notenbearbeitung),
  mehrere Finger gleichzeitig auf der Bildschirm-Tastatur (Akkorde),
  langes Drücken = Rechtsklick
- **Bluetooth-MIDI und USB-MIDI** über CoreMIDI – z. B. **Kawai ES120**
- **Fallende Noten oder Notenblatt:** Umschalter oben rechts; das Notenblatt
  (PDF) füllt die ganze Fläche, blättern per Wischen, ‹ ›, Tippen an den Rand
  oder Blätterpedal (Bild auf/ab); **Drucken** (AirPrint) und **Teilen**
- **Öffnen aus anderen Apps:** In Safari, Dateien, Mail oder AirDrop eine
  MIDI-/MusicXML-/Guitar-Pro-Datei › Teilen › **Pianooo** – sie landet in der
  Bibliothek und wird sofort geöffnet
- **Start-Katalog mit 157 Stücken und Übungen** in 7 Stufen, jeweils mit Noten-PDF – von Clementis
  Klavierschule über Hanon, Czerny, Burgmüller bis Chopin (siehe `KATALOG.md`)
- **Bibliothek in der Dateien-App**: „Auf meinem iPad › Pianooo“. MIDI-Dateien
  einfach dort hineinlegen; Bearbeitungen und Audio-Exporte landen ebenfalls dort.

## Kawai ES120 per Bluetooth verbinden

1. ES120 einschalten. Bluetooth-MIDI muss am Piano eingeschaltet sein (ab Werk
   an; sonst laut Kawai-Handbuch in den Bluetooth-Einstellungen des Pianos aktivieren).
2. Am iPad unter Einstellungen › Bluetooth prüfen, dass Bluetooth eingeschaltet ist.
   Das ES120 erscheint dort **nicht** und wird dort auch **nicht** gekoppelt – Bluetooth-MIDI wird
   in der App verbunden (dort koppelt man nur Bluetooth-Audio).
3. In Pianooo oben rechts auf **MIDI / „No keyboard“** tippen › Reiter **Keyboards** ›
   **„Connect Bluetooth keyboard…“**.
4. Im Apple-Dialog das ES120 antippen, bis „Connected“ steht, dann **Done**.
5. Das Piano erscheint in der Liste der Keyboards. Ab jetzt leuchten gespielte
   Tasten auf, Pedal und Anschlagdynamik werden übernommen.

Optional: In den Einstellungen unter **Audio** die Klang-Engine „General MIDI“
wählen und unter **MIDI Keyboard › Sound & Latency › General MIDI sound** das
ES120 einstellen – dann spielt der Song über die Klänge und Lautsprecher des Pianos.

USB geht auch: ES120 per USB-Kabel (USB-C-Adapter) ans iPad, es erscheint
automatisch.

## App aufs iPad bringen

**Fertige App:** [Pianooo.ipa](https://github.com/HOAI-droid/Pianooo/releases/download/ipad-latest/Pianooo.ipa)
(wird bei jeder Änderung auf `main` automatisch neu gebaut) – Installation siehe
[SIDELOADING.md](SIDELOADING.md).

**Variante A – Xcode (Mac nötig, kostenlose Apple-ID reicht):**

```bash
npm ci --ignore-scripts          # ELECTRON_SKIP_BINARY_DOWNLOAD=1 setzen
npm run ipad:sync                # baut die Web-App und kopiert sie ins Xcode-Projekt
npm run ipad:open                # öffnet Xcode
```

In Xcode: Target „App“ › Signing & Capabilities › eigenes Team wählen,
iPad anschließen, ▶︎ drücken. (Mit kostenloser Apple-ID muss die App alle
7 Tage neu installiert werden; mit Developer-Account 1 Jahr / TestFlight.)

**Variante B – ohne Mac:** die fertige `Pianooo.ipa` (Link oben) mit
Sideloadly oder AltStore installieren, siehe [SIDELOADING.md](SIDELOADING.md).

## Entwicklung

| Befehl | Was |
|---|---|
| `npm run ipad:dev` | Web-Teil im Browser testen (Dateien landen in IndexedDB) |
| `npm run ipad:build` | Web-Teil nach `dist-ipad/` bauen |
| `npm run ipad:sync` | Bauen + ins Xcode-Projekt kopieren |
| `bash scripts/build-mac.sh` | Mac-App bauen (auf einem Mac, nach `ipad:sync`) |
| `npm run ipad:port` | Datei-/Speicher-Logik neu aus `electron/main.ts` übernehmen (nach Orfeo-Updates) |

Aufbau:

- `src/main.ipad.tsx` – Einstieg der iPad-Version
- `src/platform/ipad/bridge.ts` – ersetzt `window.electronAPI` der Desktop-Version
- `src/platform/ipad/vfs.ts` – Dateisystem (Documents/Data der App)
- `src/platform/ipad/mainPort.generated.ts` – automatisch aus `electron/main.ts` übernommen
- `src/platform/ipad/webMidi.ts` + `ios/App/App/PianoooMidiPlugin.swift` – MIDI/Bluetooth
- `src/platform/ipad/touchShim.ts` – Touch → Maus
- `src/components/SheetView/SheetView.tsx` – Notenblatt (pdf.js), Drucken, Teilen
- `ios/App/App/PianoooFilesPlugin.swift` – Dateien aus anderen Apps, AirPrint
- `scripts/fetch-catalog.py` – lädt den Katalog (MIDI + PDF) von Mutopia

Orfeo-Updates übernehmen: `git fetch upstream && git merge upstream/main`,
dann `npm run ipad:port`.

## Notenblatt zu eigenen Songs

Pianooo sucht neben `Song.mid` eine `Song.pdf` (gleicher Name, gleicher
Ordner). Gespeicherte Versionen (`Pianooo/Song_ORFEO_v2.mid`) nutzen die PDF
des Originals. Bei MuseScore.com z. B. MIDI und PDF herunterladen und beide in
Dateien › Pianooo legen.

## Noch nicht auf dem iPad

- Akkord-Transkription als PDF (Desktop-only, nutzt pdfkit/Node)
- „Native“ Audio-Engine (Windows-only) – auf dem iPad gibt es „Samples“ und „General MIDI“
- Bibliotheksordner frei wählen – die Bibliothek ist immer der App-Ordner in „Dateien“
