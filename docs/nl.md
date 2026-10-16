# Niko Home Control II

Deze integratie verbindt Gladys met uw **Niko Home Control II**-installatie
via de **Hobby API** van de Connected Controller (of de Wireless Smart Hub), op
uw lokale netwerk: geen cloud, en elke wijziging in huis (een schakelaar, een
sfeer die start, een rolluik dat beweegt) komt meteen in Gladys aan. De
verlichting, dimmers, rolluiken, thermostaten en routines van uw installatie
verschijnen in het tabblad **Ontdekken** van Gladys, en Gladys bedient ze.
Niet officieel, niet verbonden met Niko.

> **Ontwikkelversie (0.1).** Getest met een controller die volgens de
> documentatie van de Niko Hobby API werd gesimuleerd, achter een echte
> MQTT-broker in TLS, nog niet op een echte installatie. Uw feedback is welkom
> op de GitHub-repository.

## Wat u krijgt

| In Niko Home Control                                                              | In Gladys                                                                      |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Verlichting (geschakeld)                                                          | een lamp: aan/uit                                                              |
| Dimmer                                                                            | een lamp: aan/uit, helderheid                                                  |
| Stopcontact, geschakelde uitgang, geschakelde ventilator                          | een schakelaar                                                                 |
| Rolluik, jaloezie, poort                                                          | een rolluik: openen, sluiten, stop, positie (100 = open)                       |
| Zonnescherm                                                                       | een gordijn: openen, sluiten, stop, positie                                    |
| Garagepoort                                                                       | een knop om ze te bedienen, en een poortsensor (gesloten of open)              |
| Vrije functie, sfeer, alles uit, huismodus                                        | een schakelaar (actief of niet) en een knop "Starten"                          |
| Aanwezigheidssimulatie, voorwaarde, bewegingsdetectie, piek- of zonnemodus, alarm | een schakelaar (actief of niet)                                                |
| Beldrukknop                                                                       | een deurbel (elk belsignaal is een gebeurtenis voor uw scènes) en het deurslot |
| Ventilatie (snelheidsactie)                                                       | de lijst van haar snelheden (laag, midden, hoog, boost)                        |
| Virtuele vlag                                                                     | een schakelaar                                                                 |
| Thermostaat, Touch Switch-thermostaat, virtuele thermostaat                       | temperatuur, setpunt, modus, programma, activiteit, tijdelijk setpunt, eco     |
| HVAC-thermostaat                                                                  | hetzelfde, plus verwarmen of koelen en de ventilatorsnelheid                   |
| Energiemeetklem, slimme stekker, Energy Home                                      | vermogen (W), productie, vermogen van en naar het net; aan/uit van de stekker  |
| Thermometer en andere sensoren                                                    | temperatuur, vochtigheid                                                       |
| De controller zelf                                                                | de resterende dagen tot de Hobby API-token vervalt                             |

Elk element geeft **één Gladys-toestel**, genoemd naar het element en zijn
locatie ("Spots (Woonkamer)"). De drukknoppen, modules en
bewegingsmelders zelf zijn niet zichtbaar via de Hobby API (Niko toont alleen
wat ze aansturen): om in Gladys op een drukknop te reageren, gebruikt u de
toestand van wat hij schakelt, van een vrije functie of van een virtuele vlag
die de knop omschakelt.

Nog niet ondersteund: kleur- en tunable-white-verlichting, audio,
videodeurstation, oproepen van de toegangscontrole, laadpalen,
verwarmings- en ventilatiesystemen van partners, meldingen. Niko Home Control I
(het oudere systeem) wordt niet ondersteund.

## Vereisten

- Een Niko Home Control **II**-installatie met een Connected Controller
  (550-00003) of een Wireless Smart Hub (552-00001), software 2.5.1 of nieuwer.
- De Gladys-machine bereikt de controller op het lokale netwerk (poort 8884).
  Geef de controller een vast IP-adres in uw router.
- Een **Hobby API-token** (gratis, voor privégebruik, één jaar geldig).

## De Hobby API-token verkrijgen

- **Software 2.17 of nieuwer**: open de Niko Home Control-programmeersoftware,
  maak verbinding met uw installatie, en dan **Dashboard → Verbonden diensten
  beheren**. Kies onder **Bijkomende stappen vereist** **Beheren** naast
  **Hobby API**, meld u aan met uw Niko Home Control-account, aanvaard de
  voorwaarden en gebruik **Kopiëren** om de token te krijgen.
- **Oudere software**: op mynikohomecontrol.niko.eu, **Verbonden diensten →
  Dienst toevoegen → Hobby API**, en kopieer de token.

De controller moet online zijn (verbonden met internet) de eerste keer dat de
token gebruikt wordt. Daarna blijft alles op uw lokale netwerk.

## Installatie

1. Open in Gladys de integratie, **Configuratie**:
   - **IP-adres van de Connected Controller**: bijvoorbeeld `192.168.1.50`.
     Onbekend? Laat het leeg, sla op en klik op **Find the controller**:
     Gladys zoekt hem op het netwerk en bewaart zijn adres.
   - **Hobby API-token**: plak de volledige token (een lange tekst in drie
     delen, gescheiden door punten).
2. Klik op **Test the connection**: de versie van Niko Home Control, het aantal
   aangeboden toestellen en de vervaldatum van de token verschijnen.
3. Open het tabblad **Ontdekken** en voeg de gewenste toestellen toe. Hun
   waarden worden meteen verzonden, en elke wijziging volgt onmiddellijk.

De configuratie van Gladys bestaat in het Frans en het Engels; kies **Dutch**
als taal van de functienamen om ze in het Nederlands te krijgen.

## Opties

- **Minimale tijd tussen twee metingen**: standaard 10 seconden (0 tot 600).
  Vermogens en temperaturen kunnen om de paar seconden veranderen: Gladys
  houdt de laatste meting in dit tempo bij. Verlichting, rolluiken, setpunten
  en schakelaars worden nooit vertraagd.
- **Duur van een setpunt dat vanuit Gladys is ingesteld**: standaard 60
  minuten (1 tot 1439). Op een Niko-thermostaat is een setpunt dat in Gladys
  wordt gewijzigd tijdelijk ("overrule"); daarna volgt de thermostaat weer zijn
  programma. Gebruik de functie **Programma** (Dag, Nacht, Eco, Uit,
  Programma 1…) om van programma te wisselen.
- **Taal van de functienamen**: Frans, Engels of Nederlands.

## Vervaldatum van de token

De token is één jaar geldig. Het toestel van de controller toont de
**resterende dagen**; vanaf 14 dagen voor de vervaldatum waarschuwen de status
van de integratie, de badge van de controller en de logboeken u, en de
scènetrigger **"Hobby API token about to expire"** gaat één keer per dag af
(met de resterende dagen en de vervaldatum). Niko laat u de token in de
laatste maand vernieuwen: plak de nieuwe in de configuratie. Een vervallen
token wordt niet gebruikt; de status meldt het.

## Problemen oplossen

- **"The controller is unreachable"**: controleer het IP-adres en of de
  Gladys-machine op hetzelfde netwerk zit. De integratie probeert het zelf
  opnieuw (5 seconden, daarna tot 5 minuten).
- **"The controller refused the Hobby API token"**: de token is vervallen of
  vervangen; plak een nieuwe. De integratie probeert het maar om de 30 minuten
  opnieuw, om de controller te sparen.
- **"Its TLS certificate was not issued by Niko"**: het adres is niet dat van
  uw controller. De integratie vertrouwt alleen de certificaatautoriteit van
  Niko.
- **Een opdracht heeft geen effect**: het toestel is misschien offline voor de
  controller (de badge toont het). Niko aanvaardt maximaal 5 toepassingen
  tegelijk op de Hobby API: sluit andere (Home Assistant, Node-RED…) als de
  verbinding geweigerd wordt.

## Privacy

De integratie praat alleen met uw controller, op uw lokale netwerk, met de
token die u haar geeft (door Gladys als geheim bewaard, nooit in de logboeken
geschreven). Niko biedt de Hobby API aan voor privé, niet-commercieel gebruik.
