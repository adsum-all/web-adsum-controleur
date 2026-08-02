import { useEffect, useState } from "react";

import { MARQUE_DEFAUT, type MarquePublique, getMarquePublique } from "./marque.js";
import { appliquerCouleurMarque } from "./marqueCss.js";

/**
 * The organisation's identity, fetched once for the whole application.
 *
 * Held in a module-level store rather than per component: every screen that wants the
 * organisation's name would otherwise issue its own request for the same unchanging
 * answer. One fetch, one shared value, and every subscriber re-renders when it lands.
 *
 * The last known identity is kept locally so the first paint carries the right name
 * and the right colour instead of flashing the platform's, and the shipped values are
 * the fallback so an unreachable API still renders something coherent.
 */
const CLE = "adsum.marque";

function charger(): MarquePublique {
  try {
    const brut = typeof localStorage !== "undefined" ? localStorage.getItem(CLE) : null;
    const m = brut
      ? { ...MARQUE_DEFAUT, ...(JSON.parse(brut) as Partial<MarquePublique>) }
      : MARQUE_DEFAUT;
    appliquerCouleurMarque(m.couleur, m.couleur_sombre);
    return m;
  } catch {
    return MARQUE_DEFAUT;
  }
}

let courante: MarquePublique = charger();
const abonnes = new Set<(m: MarquePublique) => void>();
let enCours: Promise<void> | null = null;

/** The identity as last known, without subscribing. For code outside a component. */
export function marqueCourante(): MarquePublique {
  return courante;
}

/** Fetch the identity at most once per page load, however many callers ask. */
function rafraichir(): void {
  if (enCours) return;
  enCours = getMarquePublique()
    .then((m) => {
      appliquerCouleurMarque(m.couleur, m.couleur_sombre);
      courante = m;
      try {
        localStorage.setItem(CLE, JSON.stringify(m));
      } catch {
        /* private mode: the identity stays in memory for this visit. */
      }
      for (const notifier of abonnes) notifier(m);
    })
    .catch(() => {
      // Left on the last known identity. Cleared so a later mount may retry rather
      // than the application staying on shipped defaults for the whole visit.
      enCours = null;
    });
}

export function useMarque(): MarquePublique {
  const [marque, setMarque] = useState<MarquePublique>(courante);

  useEffect(() => {
    // Another component may have received the answer between this render and this
    // effect, in which case the local copy is already stale.
    if (marque !== courante) setMarque(courante);
    abonnes.add(setMarque);
    rafraichir();
    return () => {
      abonnes.delete(setMarque);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return marque;
}
