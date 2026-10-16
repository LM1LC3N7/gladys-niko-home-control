# Niko Home Control II

Cette intégration relie Gladys à votre installation **Niko Home Control II**
par la **Hobby API** de son Connected Controller (ou de son Wireless Smart
Hub), sur votre réseau local : pas de cloud, et chaque changement dans la
maison (un interrupteur appuyé, une ambiance lancée, un volet qui bouge)
arrive aussitôt dans Gladys. Les éclairages, variateurs, volets, thermostats et
routines de votre installation apparaissent dans l'onglet **Découverte** de
Gladys, et Gladys les pilote. Non officiel, sans lien avec Niko.

> **Version de développement (0.1).** Testée avec un contrôleur simulé
> d'après la documentation de la Hobby API de Niko, derrière un vrai broker
> MQTT en TLS, pas encore sur une vraie installation. Vos retours sont les
> bienvenus sur le dépôt GitHub.

## Ce que vous obtenez

| Dans Niko Home Control                                                                    | Dans Gladys                                                                         |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Éclairage (commuté)                                                                       | une lumière : allumage                                                              |
| Variateur                                                                                 | une lumière : allumage, luminosité                                                  |
| Prise, sortie commutée, ventilateur commuté                                               | un interrupteur                                                                     |
| Volet roulant, store vénitien, portail                                                    | un volet : ouvrir, fermer, stop, position (100 = ouvert)                            |
| Store banne (sunblind)                                                                    | un rideau : ouvrir, fermer, stop, position                                          |
| Porte de garage                                                                           | un bouton pour l'actionner, et un capteur de porte (fermée ou ouverte)              |
| Fonction libre, ambiance, tout éteint, mode maison                                        | un interrupteur (active ou non) et un bouton « Lancer »                             |
| Simulation de présence, condition, détection de mouvement, mode pointe ou solaire, alarme | un interrupteur (active ou non)                                                     |
| Bouton de sonnette                                                                        | une sonnette (chaque coup est un événement pour vos scènes) et la gâche de la porte |
| Ventilation (action de vitesse)                                                           | la liste de ses vitesses (faible, moyenne, forte, boost)                            |
| Drapeau virtuel                                                                           | un interrupteur                                                                     |
| Thermostat, thermostat Touch Switch, thermostat virtuel                                   | température, consigne, mode, programme, activité, consigne temporaire, éco          |
| Thermostat HVAC                                                                           | la même chose, plus chauffage ou refroidissement et la vitesse de ventilation       |
| Pince de mesure électrique, prise connectée, Energy Home                                  | puissance (W), production, puissance soutirée et injectée ; la marche de la prise   |
| Thermomètre et autres capteurs                                                            | température, humidité                                                               |
| Le contrôleur lui-même                                                                    | les jours restants avant l'expiration du jeton Hobby API                            |

Chaque élément donne **un appareil Gladys**, nommé d'après lui et son
emplacement (« Spots (Salon) ») ; son identifiant Niko, son modèle et son
emplacement sont gardés dans ses paramètres. Les boutons poussoirs, modules et
détecteurs de mouvement eux-mêmes ne sont pas visibles par la Hobby API (Niko
n'expose que ce qu'ils commandent) : pour réagir dans Gladys à un bouton
poussoir, utilisez l'état de ce qu'il commute, d'une fonction libre ou d'un
drapeau virtuel que le bouton bascule.

Pas encore pris en charge : éclairages couleur et blanc réglable, audio,
portier vidéo, appels du contrôle d'accès, bornes de recharge, systèmes de
chauffage et de ventilation partenaires, notifications. Niko Home Control I
(l'ancien système) n'est pas pris en charge.

## Prérequis

- Une installation Niko Home Control **II** avec un Connected Controller
  (550-00003) ou un Wireless Smart Hub (552-00001), logiciel 2.5.1 ou plus
  récent.
- La machine Gladys joint le contrôleur sur le réseau local (port 8884).
  Donnez au contrôleur une adresse IP fixe dans votre box.
- Un **jeton Hobby API** (gratuit, pour un usage privé, valable un an).

## Obtenir le jeton Hobby API

- **Logiciel 2.17 ou plus récent** : ouvrez le logiciel de programmation
  Niko Home Control, connectez-vous à votre installation, puis **Tableau de
  bord → Gérer les services connectés**. Sous **Étapes supplémentaires
  requises**, choisissez **Gérer** à côté de **Hobby API**, connectez-vous avec
  votre compte Niko Home Control, acceptez les conditions, et utilisez
  **Copier** pour obtenir le jeton.
- **Logiciel plus ancien** : sur mynikohomecontrol.niko.eu, **Services
  connectés → Ajouter un service → Hobby API**, puis copiez le jeton.

Le contrôleur doit être en ligne (connecté à Internet) la première fois que le
jeton sert. Ensuite, tout reste sur votre réseau local.

## Installation

1. Dans Gladys, ouvrez l'intégration, **Configuration** :
   - **Adresse IP du Connected Controller** : par exemple `192.168.1.50`.
     Inconnue ? Laissez-la vide, enregistrez, et cliquez sur **Trouver le
     contrôleur** : Gladys le cherche sur le réseau et enregistre son adresse.
   - **Jeton Hobby API** : collez le jeton entier (un long texte en trois
     parties séparées par des points).
2. Cliquez sur **Tester la connexion** : la version de Niko Home Control, le
   nombre d'appareils proposés et la date d'expiration du jeton s'affichent.
3. Ouvrez l'onglet **Découverte** et ajoutez les appareils voulus. Leurs
   valeurs sont envoyées dès l'ajout, et chaque changement suit aussitôt.

## Options

- **Intervalle minimum entre deux mesures d'une grandeur** : 10 secondes par
  défaut (0 à 600). Puissances et températures peuvent changer toutes les
  quelques secondes : Gladys garde la dernière mesure à ce rythme.
  Éclairages, volets, consignes et interrupteurs ne sont jamais retardés.
- **Durée d'une consigne réglée depuis Gladys** : 60 minutes par défaut (1 à
  1439). Sur un thermostat Niko, une consigne changée dans Gladys est une
  consigne temporaire (Niko parle d'« overrule ») ; ensuite le thermostat
  reprend son programme. Pour changer de programme, utilisez la fonctionnalité
  **Programme** (Jour, Nuit, Éco, Arrêt, Programme 1…).
- **Langue des noms des fonctionnalités** : français, anglais ou néerlandais.

## Thermostats

- **Consigne** : une consigne temporaire, pour la durée choisie.
  L'interrupteur **Consigne temporaire** montre quand elle est active ;
  éteignez-le pour revenir au programme tout de suite.
- **Mode** : arrêt (programme Arrêt), chauffage (Jour, Nuit, Éco),
  refroidissement (programme Refroidissement, si votre thermostat l'a) ou
  automatique (les programmes hebdomadaires 1 à 3). Demander le chauffage
  quand le thermostat est déjà en Nuit ou en Éco garde ce programme.
  Thermostats HVAC : arrêt, chauffage ou refroidissement.
- **Activité** : chauffe, refroidit ou au repos, selon la demande du
  thermostat.

## Compteurs

Niko n'envoie la puissance instantanée que pendant 30 secondes après qu'on l'a
demandée : tant qu'un compteur ou une prise connectée existe dans Gladys,
l'intégration la redemande toutes les 25 secondes. Supprimez l'appareil de
Gladys pour arrêter. Les totaux d'énergie ne passent pas encore par les
messages de la Hobby API.

## Expiration du jeton

Le jeton est valable un an. L'appareil du contrôleur montre les **jours
restants** ; à partir de 14 jours avant l'expiration, le statut de
l'intégration, le badge de l'appareil du contrôleur et les journaux vous
préviennent, et le déclencheur de scène **« Jeton Hobby API bientôt
expiré »** se déclenche une fois par jour (avec les jours restants et la date
d'expiration) : servez-vous-en pour vous envoyer un message. Niko permet de
renouveler le jeton pendant le dernier mois : collez le nouveau dans la
configuration. Un jeton expiré n'est pas utilisé ; le statut le dit.

## En cas de problème

- **« Le contrôleur est injoignable »** : vérifiez son adresse IP et que la
  machine Gladys est sur le même réseau. L'intégration réessaie d'elle-même
  (5 secondes, puis jusqu'à 5 minutes).
- **« Le contrôleur a refusé le jeton Hobby API »** : le jeton a expiré ou a
  été remplacé ; collez-en un nouveau. L'intégration ne réessaie que toutes
  les 30 minutes, pour ménager le contrôleur.
- **« Son certificat TLS n'a pas été émis par Niko »** : l'adresse n'est pas
  celle de votre contrôleur. L'intégration ne fait confiance qu'à l'autorité de
  certification de Niko.
- **Une commande reste sans effet** : l'appareil est peut-être hors ligne pour
  le contrôleur (son badge l'indique). Niko accepte au plus 5 applications à
  la fois sur la Hobby API : fermez-en d'autres (Home Assistant, Node-RED…) si
  la connexion est refusée.
- **Nouveaux appareils ou noms changés** : après l'envoi d'une nouvelle
  configuration au contrôleur, l'intégration relit les appareils ; cliquez sur
  **Scanner** dans l'onglet Découverte pour le forcer.

## Vie privée

L'intégration ne parle qu'à votre contrôleur, sur votre réseau local, avec le
jeton que vous lui donnez (gardé par Gladys comme un secret, jamais écrit dans
les journaux). Niko propose la Hobby API pour un usage privé, non commercial.
