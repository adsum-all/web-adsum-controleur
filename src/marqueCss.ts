/**
 * Push the organisation's colour into the stylesheet, so the interface wears it.
 *
 * These applications colour themselves through custom properties (--adsum-acc and
 * the --adsum-brand-* scale). An organisation could set its colour in the back
 * office, see it on its e-mails, and never once in the interface: the setting existed
 * and changed nothing on screen.
 *
 * An organisation names ONE colour. Asking a settings screen for a ten-shade scale is
 * how it stops being usable, so the scale is derived here by moving that colour
 * toward white and toward black.
 *
 * Written onto the root element rather than into the stylesheet, which means the dark
 * theme keeps its own overrides: a value set on :root by script wins over a value
 * declared in a rule, and both remain readable.
 */

/** What the platform shipped with. Also the fallback for an unusable setting. */
const ORIGINE = "#2a4fad";
const ORIGINE_SOMBRE = "#1d3470";

/**
 * Every step of the scale: its name, the shade the platform shipped, and how far it
 * sits from the chosen colour (positive toward white, negative toward black).
 *
 * One array rather than two lookup tables, so a step can never exist in one and be
 * missing from the other, and so nothing here is read through an index that the
 * compiler has to assume might be absent.
 */
const ECHELONS: ReadonlyArray<readonly [nom: string, origine: string, pas: number]> = [
  ["50", "#eef3fc", 0.93],
  ["100", "#d9e4f8", 0.83],
  ["200", "#b4c8f0", 0.63],
  ["300", "#8aa8e6", 0.42],
  ["400", "#5b82d8", 0.24],
  ["500", "#3563c9", 0.1],
  ["600", "#2a4fad", 0],
  ["700", "#223f8a", -0.19],
  ["800", "#1d3470", -0.33],
  ["900", "#172a5a", -0.48],
];

/** The lightest shade, used to tint backgrounds when nothing else is configured. */
const TEINTE_ORIGINE = "#eef3fc";

type Canaux = [number, number, number];

function versCanaux(hex: string): Canaux | null {
  const v = (hex || "").trim().replace("#", "");
  const complet = v.length === 3 ? v.split("").map((c) => c + c).join("") : v;
  if (complet.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(complet)) return null;
  return [
    Number.parseInt(complet.slice(0, 2), 16),
    Number.parseInt(complet.slice(2, 4), 16),
    Number.parseInt(complet.slice(4, 6), 16),
  ];
}

function versHex([r, v, b]: Canaux): string {
  const deux = (n: number): string =>
    Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${deux(r)}${deux(v)}${deux(b)}`;
}

/** Move a colour toward white (ratio > 0) or toward black (ratio < 0). */
function nuance(canaux: Canaux, ratio: number): string {
  if (ratio === 0) return versHex(canaux);
  const cible = ratio > 0 ? 255 : 0;
  const force = Math.abs(ratio);
  return versHex([
    canaux[0] + (cible - canaux[0]) * force,
    canaux[1] + (cible - canaux[1]) * force,
    canaux[2] + (cible - canaux[2]) * force,
  ]);
}

/**
 * Adopt the organisation's colour. A value that is not a usable hex is ignored, so a
 * mistyped setting leaves the interface legible rather than unreadable.
 */
export function appliquerCouleurMarque(
  couleur: string | null | undefined,
  sombre?: string | null,
): void {
  if (typeof document === "undefined") return;
  const canaux = versCanaux(couleur ?? "");
  const base = canaux ? versHex(canaux) : ORIGINE;
  const canauxSombre = versCanaux(sombre ?? "");
  const fonce = canauxSombre ? versHex(canauxSombre) : ORIGINE_SOMBRE;

  const racine = document.documentElement.style;
  // An organisation that kept the platform's colour keeps the platform's exact
  // shades. Deriving them would shift several by a few points for no reason anybody
  // asked for, and "nothing changes until you decide" has to hold for pixels too.
  // Written as `canaux && ...` rather than through a boolean: the compiler narrows
  // the tuple to non-null from the test itself, which a separate flag would hide.
  const derive = base.toLowerCase() !== ORIGINE;
  for (const [nom, origine, pas] of ECHELONS) {
    racine.setProperty(`--adsum-brand-${nom}`, canaux && derive ? nuance(canaux, pas) : origine);
  }
  racine.setProperty("--adsum-acc", base);
  racine.setProperty("--adsum-acc2", fonce);
  // The public front tints backgrounds with this one; derived rather than declared so
  // it never drifts from the accent it is supposed to be a soft version of.
  racine.setProperty("--accent-soft", canaux && derive ? nuance(canaux, 0.88) : TEINTE_ORIGINE);
}
