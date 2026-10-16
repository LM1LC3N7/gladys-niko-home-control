// -----------------------------------------------------------------------------
// Texts shown in Gladys (connection status, buttons, badges) in English and
// French, and the names given to the features in Discovery in French, English
// or Dutch (the `language` setting). Never put a token in one of them.
// -----------------------------------------------------------------------------

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const day = (date) => (date instanceof Date ? date.toISOString().slice(0, 10) : '?');

/** Feature names, per language. */
export const NAMES = {
  binary: { fr: 'Marche/arrêt', en: 'On/off', nl: 'Aan/uit' },
  brightness: { fr: 'Luminosité', en: 'Brightness', nl: 'Helderheid' },
  state: { fr: 'Ouvrir / fermer', en: 'Open / close', nl: 'Openen / sluiten' },
  position: { fr: 'Position', en: 'Position', nl: 'Positie' },
  run: { fr: 'Lancer', en: 'Run', nl: 'Starten' },
  active: { fr: 'Active', en: 'Active', nl: 'Actief' },
  detection: { fr: 'Détection active', en: 'Detection enabled', nl: 'Detectie actief' },
  operate: { fr: 'Actionner la porte', en: 'Operate the door', nl: 'Poort bedienen' },
  closed: { fr: 'Porte fermée', en: 'Door closed', nl: 'Poort gesloten' },
  ring: { fr: 'Sonnette', en: 'Doorbell', nl: 'Deurbel' },
  doorlock: { fr: 'Gâche (déverrouiller)', en: 'Door lock (unlock)', nl: 'Deurslot (openen)' },
  speed: { fr: 'Vitesse', en: 'Speed', nl: 'Snelheid' },
  temperature: { fr: 'Température', en: 'Temperature', nl: 'Temperatuur' },
  humidity: { fr: 'Humidité', en: 'Humidity', nl: 'Vochtigheid' },
  setpoint: { fr: 'Consigne', en: 'Setpoint', nl: 'Setpunt' },
  mode: { fr: 'Mode', en: 'Mode', nl: 'Modus' },
  program: { fr: 'Programme', en: 'Program', nl: 'Programma' },
  activity: { fr: 'Activité', en: 'Activity', nl: 'Activiteit' },
  overrule: { fr: 'Consigne temporaire', en: 'Temporary setpoint', nl: 'Tijdelijk setpunt' },
  eco: { fr: 'Éco', en: 'Eco', nl: 'Eco' },
  fan: { fr: 'Ventilation', en: 'Fan', nl: 'Ventilatie' },
  power: { fr: 'Puissance', en: 'Power', nl: 'Vermogen' },
  production: { fr: 'Production', en: 'Production', nl: 'Productie' },
  fromGrid: { fr: 'Puissance soutirée', en: 'Power from the grid', nl: 'Vermogen van het net' },
  toGrid: { fr: 'Puissance injectée', en: 'Power to the grid', nl: 'Vermogen naar het net' },
  tokenDays: {
    fr: 'Jeton Hobby API : jours restants',
    en: 'Hobby API token: days left',
    nl: 'Hobby API-token: resterende dagen',
  },
  controller: {
    fr: 'Niko Home Control II',
    en: 'Niko Home Control II',
    nl: 'Niko Home Control II',
  },
};

/** Labels of the Niko choices (programs, fan speeds), per language; unknown ones keep Niko's word. */
export const CHOICES = {
  Day: { fr: 'Jour', en: 'Day', nl: 'Dag' },
  Night: { fr: 'Nuit', en: 'Night', nl: 'Nacht' },
  Eco: { fr: 'Éco', en: 'Eco', nl: 'Eco' },
  Off: { fr: 'Arrêt', en: 'Off', nl: 'Uit' },
  Cool: { fr: 'Refroidissement', en: 'Cooling', nl: 'Koelen' },
  Custom: { fr: 'Personnalisé', en: 'Custom', nl: 'Aangepast' },
  Prog1: { fr: 'Programme 1', en: 'Program 1', nl: 'Programma 1' },
  Prog2: { fr: 'Programme 2', en: 'Program 2', nl: 'Programma 2' },
  Prog3: { fr: 'Programme 3', en: 'Program 3', nl: 'Programma 3' },
  Home: { fr: 'Maison', en: 'Home', nl: 'Thuis' },
  Away: { fr: 'Absent', en: 'Away', nl: 'Afwezig' },
  Vacation: { fr: 'Vacances', en: 'Vacation', nl: 'Vakantie' },
  Schedule: { fr: 'Planning', en: 'Schedule', nl: 'Planning' },
  Low: { fr: 'Faible', en: 'Low', nl: 'Laag' },
  Medium: { fr: 'Moyenne', en: 'Medium', nl: 'Midden' },
  High: { fr: 'Forte', en: 'High', nl: 'Hoog' },
  Boost: { fr: 'Boost', en: 'Boost', nl: 'Boost' },
  Auto: { fr: 'Auto', en: 'Auto', nl: 'Auto' },
};

export const nameOf = (key, language) => NAMES[key]?.[language] ?? NAMES[key]?.en ?? key;
export const choiceLabel = (value, language) => CHOICES[value]?.[language] ?? value;

/** The renewal hint, shared by the token messages. */
const RENEW = {
  en: 'Create a new one in the Niko Home Control programming software (Dashboard, Manage connected services, Hobby API; on mynikohomecontrol before 2.17), then paste it in the configuration.',
  fr: 'Créez-en un nouveau dans le logiciel de programmation Niko Home Control (tableau de bord, Gérer les services connectés, Hobby API ; sur mynikohomecontrol avant la 2.17), puis collez-le dans la configuration.',
};

export const T = {
  configError(error) {
    switch (error) {
      case 'empty':
        return {
          en: 'Type the address of your Connected Controller (or use "Find the controller") and your Hobby API token in the configuration.',
          fr: "Saisissez l'adresse de votre Connected Controller (ou utilisez « Trouver le contrôleur ») et votre jeton Hobby API dans la configuration.",
        };
      case 'no-token':
        return {
          en: 'Paste your Hobby API token in the configuration.',
          fr: 'Collez votre jeton Hobby API dans la configuration.',
        };
      case 'bad-token':
        return {
          en: 'The Hobby API token is not valid: paste the whole token (three parts separated by dots), as Niko gives it.',
          fr: "Le jeton Hobby API n'est pas valide : collez le jeton entier (trois parties séparées par des points), tel que Niko le donne.",
        };
      case 'credentials':
        return {
          en: 'No user name or password in the address: only the IP address or the host name of the controller.',
          fr: "Pas d'utilisateur ni de mot de passe dans l'adresse : seulement l'adresse IP ou le nom du contrôleur.",
        };
      default:
        return {
          en: 'The address of the controller is not valid: type its IP address (192.168.1.50) or its host name.',
          fr: "L'adresse du contrôleur n'est pas valide : saisissez son adresse IP (192.168.1.50) ou son nom.",
        };
    }
  },
  tokenExpired: (expiresAt) => ({
    en: `The Hobby API token expired on ${day(expiresAt)}. ${RENEW.en}`,
    fr: `Le jeton Hobby API a expiré le ${day(expiresAt)}. ${RENEW.fr}`,
  }),
  tokenSoon: (days, expiresAt) => ({
    en: `The Hobby API token expires in ${plural(days, 'day', 'days')} (${day(expiresAt)}). ${RENEW.en}`,
    fr: `Le jeton Hobby API expire dans ${plural(days, 'jour', 'jours')} (${day(expiresAt)}). ${RENEW.fr}`,
  }),
  connecting: {
    en: 'Connecting to the Niko Home Control controller…',
    fr: 'Connexion au contrôleur Niko Home Control…',
  },
  connected: ({ version, offered, warning }) => ({
    en: `Connected to Niko Home Control${version ? ` ${version}` : ''}: ${plural(offered, 'device', 'devices')} in Discovery.${warning ? ` ${warning.en}` : ''}`,
    fr: `Connecté à Niko Home Control${version ? ` ${version}` : ''} : ${plural(offered, 'appareil', 'appareils')} dans Découverte.${warning ? ` ${warning.fr}` : ''}`,
  }),
  /** The status of a lost or refused connection (see client.js failureKind). */
  failure({ kind, reason, retryIn }) {
    const retry =
      retryIn === undefined
        ? { en: '', fr: '' }
        : {
            en: ` Retrying in ${Math.max(1, Math.round(retryIn / 1000))} s.`,
            fr: ` Nouvel essai dans ${Math.max(1, Math.round(retryIn / 1000))} s.`,
          };
    switch (kind) {
      case 'refused':
        return {
          en: `The controller refused the Hobby API token (${reason}): it may have expired or been replaced. ${RENEW.en}`,
          fr: `Le contrôleur a refusé le jeton Hobby API (${reason}) : il a peut-être expiré ou été remplacé. ${RENEW.fr}`,
        };
      case 'certificate':
        return {
          en: `The device at this address is not a Niko controller: its TLS certificate was not issued by Niko (${reason}). Check the address.${retry.en}`,
          fr: `L'appareil à cette adresse n'est pas un contrôleur Niko : son certificat TLS n'a pas été émis par Niko (${reason}). Vérifiez l'adresse.${retry.fr}`,
        };
      case 'unreachable':
        return {
          en: `The controller is unreachable (${reason}): check its IP address, and that the Hobby API is enabled (port 8884).${retry.en}`,
          fr: `Le contrôleur est injoignable (${reason}) : vérifiez son adresse IP, et que la Hobby API est activée (port 8884).${retry.fr}`,
        };
      default:
        return {
          en: `Connection to the controller lost: ${reason}.${retry.en}`,
          fr: `Connexion au contrôleur perdue : ${reason}.${retry.fr}`,
        };
    }
  },
  badge: {
    deviceOffline: {
      en: 'The controller reports this device offline',
      fr: 'Le contrôleur signale cet appareil hors ligne',
    },
    controllerOffline: {
      en: 'The Niko Home Control controller is not connected',
      fr: "Le contrôleur Niko Home Control n'est pas connecté",
    },
    tokenSoon: (days) => ({
      en: `Hobby API token: ${plural(days, 'day', 'days')} left`,
      fr: `Jeton Hobby API : ${plural(days, 'jour restant', 'jours restants')}`,
    }),
  },
  test: {
    ok: ({ version, offered, total, unsupported, expiresAt, daysLeft }) => {
      const token =
        daysLeft === undefined
          ? { en: '', fr: '' }
          : {
              en: ` Token valid until ${day(expiresAt)} (${plural(daysLeft, 'day', 'days')}).`,
              fr: ` Jeton valable jusqu'au ${day(expiresAt)} (${plural(daysLeft, 'jour', 'jours')}).`,
            };
      return {
        en: `Connected to Niko Home Control${version ? ` ${version}` : ''}: ${plural(offered, 'device', 'devices')} offered in Discovery out of ${total} listed${unsupported ? ` (${unsupported} of a kind not supported yet)` : ''}.${token.en}`,
        fr: `Connecté à Niko Home Control${version ? ` ${version}` : ''} : ${plural(offered, 'appareil proposé', 'appareils proposés')} dans Découverte sur ${total} listés${unsupported ? ` (${unsupported} d'un type pas encore pris en charge)` : ''}.${token.fr}`,
      };
    },
    timeout: {
      en: 'The controller did not answer in time.',
      fr: "Le contrôleur n'a pas répondu à temps.",
    },
  },
  find: {
    none: {
      en: 'No Niko Home Control controller answered on the local network. Type its IP address (shown in the Niko Home Control programming software, or by your router).',
      fr: "Aucun contrôleur Niko Home Control n'a répondu sur le réseau local. Saisissez son adresse IP (affichée par le logiciel de programmation Niko Home Control, ou par votre box).",
    },
    unavailable: (reason) => ({
      en: `The search is not available on this Gladys (${reason}). Type the IP address of the controller.`,
      fr: `La recherche n'est pas disponible sur ce Gladys (${reason}). Saisissez l'adresse IP du contrôleur.`,
    }),
    found: ({ controllers, saved }) => {
      const list = controllers
        .map((c) => `${c.ip}${c.generation === 1 ? ' (Niko Home Control I)' : ''}`)
        .join(', ');
      return {
        en: `Found: ${list}.${saved ? ` ${saved} saved as the address of the controller.` : ' Type the address of your controller in the configuration.'}${controllers.some((c) => c.generation === 1) ? ' Niko Home Control I is not supported yet.' : ''}`,
        fr: `Trouvé : ${list}.${saved ? ` ${saved} enregistrée comme adresse du contrôleur.` : ' Saisissez l’adresse de votre contrôleur dans la configuration.'}${controllers.some((c) => c.generation === 1) ? ' Niko Home Control I n’est pas encore pris en charge.' : ''}`,
      };
    },
  },
  notConnected: {
    en: 'The controller is not connected',
    fr: "Le contrôleur n'est pas connecté",
  },
};
