// The controller's help store, kept on the device.
//
// This application registers no service worker. Help fetched over the network would
// therefore be missing at exactly the moment it is needed: at the door, in front of
// a queue, with no coverage. The store is filled while the connection is still up,
// when the event is chosen, and read back when it is not.
//
// It is cleared on sign-out for the same reason the member directory is: the corpus
// was filtered against the rights of whoever loaded it, and serving it to the next
// controller would show them articles they may not read.

const KEY = "adsum.controleur.aide";

/** The screens whose help is worth fetching before the network is lost. */
export const ECRANS = ["controleur.scan", "controleur.manual", "controleur.queue"];

type Contenu = Record<string, unknown>;

function lireTout(): Contenu {
  try {
    const brut = localStorage.getItem(KEY);
    return brut ? (JSON.parse(brut) as Contenu) : {};
  } catch {
    // Private mode, quota, or a payload someone edited by hand. An empty store
    // means the help falls back to the network, which is the ordinary case.
    return {};
  }
}

export const rangementAide = {
  lire(cle: string): unknown {
    return lireTout()[cle] ?? null;
  },
  ecrire(cle: string, valeur: unknown): void {
    try {
      const contenu = lireTout();
      contenu[cle] = valeur;
      localStorage.setItem(KEY, JSON.stringify(contenu));
    } catch {
      /* Nothing to do: the read in progress is already served. */
    }
  },
};

export function viderAide(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* private mode */
  }
}

/**
 * Fill the store while the connection is still up.
 *
 * Failures are swallowed on purpose. Help that could not be prefetched is a
 * degraded situation, not a reason to stop a controller from opening an event.
 */
export async function precharger(
  charger: (cleEcran: string) => Promise<unknown>,
): Promise<void> {
  await Promise.all(ECRANS.map((ecran) => charger(ecran).catch(() => undefined)));
}
