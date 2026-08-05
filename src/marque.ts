/**
 * The organisation's identity, read from the platform rather than written into it.
 *
 * The sign-in screen and the header carry a name and a colour, and they are shown to
 * somebody who has no token yet, so those values used to be literals in the code.
 * Every deployment of this product then greeted its users with somebody else's name
 * in somebody else's blue.
 *
 * Self-contained on purpose: it resolves its own base address exactly as this
 * application's api module does, so adopting the identity in one more front is three
 * new files and no edit to an existing one.
 */
const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "https://adsum-api.vercel.app";

/** One term in the organisation's own words, in its three written forms. */
export interface MotOrganisation {
  singulier: string;
  pluriel: string;
  article: string;
  Singulier: string;
  Pluriel: string;
  avec_article: string;
}

export interface MarquePublique {
  /** The product line, shown large in the header. */
  marque: string;
  initiale: string;
  /** Who is writing: shown under the brand, and in footers. */
  organisation: string;
  organisation_courte: string;
  slogan: string | null;
  logo_url: string | null;
  site: string | null;
  /** Where this organisation's other applications are served. Null when undeclared,
   *  which means "offer no link" rather than "fall back to another organisation". */
  url_membre: string | null;
  url_back_office: string | null;
  url_public: string | null;
  couleur: string;
  couleur_sombre: string;
  /** How this organisation names its units and responsibilities. A parish says
   *  secteur where another says intendance, and the interface must follow. */
  mots: Record<string, MotOrganisation>;
}

/** What the platform shipped with, and the fallback when the API is unreachable. */
export const MARQUE_DEFAUT: MarquePublique = {
  marque: "ADSUM",
  initiale: "A",
  organisation: "Sacerdoce Royal",
  organisation_courte: "SR",
  slogan: null,
  logo_url: null,
  site: null,
  url_membre: null,
  url_back_office: null,
  url_public: null,
  couleur: "#2a4fad",
  couleur_sombre: "#1d3470",
  mots: {},
};

/** One term, with a shipped word as the fallback: mot(m, "tribu", "Pluriel"). */
export function mot(
  marque: MarquePublique,
  terme: string,
  facette: keyof MotOrganisation = "singulier",
  repli = "",
): string {
  const m = marque.mots?.[terme];
  return (m ? m[facette] : "") || repli || terme;
}

/** The identity, unauthenticated: the sign-in screen needs it before any token. */
export async function getMarquePublique(): Promise<MarquePublique> {
  const res = await fetch(`${BASE}/api/v1/marque`);
  if (!res.ok) throw new Error(`identité indisponible (${res.status})`);
  const brut = (await res.json()) as Partial<MarquePublique>;
  // Merged over the shipped defaults so a field the server has not yet learned to
  // send leaves the interface coherent rather than undefined.
  return { ...MARQUE_DEFAUT, ...brut };
}
