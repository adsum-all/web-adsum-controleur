/**
 * Refuse a component that calls a hook after an early return.
 *
 * React counts the hooks a render calls and refuses a render that calls a different
 * number than the one before. A component that returns early while loading and then
 * calls a hook further down calls fewer hooks on its first render than on its second,
 * so it crashes the moment its data arrives: the page goes white and takes the whole
 * application tree with it.
 *
 * Two pages of the back office shipped that way and nobody saw it, because the only
 * check in place is `tsc --noEmit` and the type checker cannot see hook order. This
 * runs beside it, so the same mistake stops at the gate instead of reaching a screen.
 *
 * Precision matters more than reach here. Only two shapes count as an early return,
 * and both are what a component actually writes when it bails out while loading:
 *
 *     return <spinner />;                 at the top level of the body
 *     if (!data) { return <spinner />; }  a conditional at the top level of the body
 *
 * And only a hook bound at the top level of the body counts, because one nested in a
 * callback is not a hook call in React's sense. Indentation carries that distinction
 * reliably: this codebase is formatted with two spaces throughout.
 *
 * Usage: node scripts/verifier-hooks.mjs [dossier]
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const RACINE = process.argv[2] || "src";

const DECLARATION = /^(?:export\s+)?(?:default\s+)?function\s+([A-Za-z_]\w*)\s*[(<]/;
const HOOK_LIE = /^ {2}(?:const|let|var)\s+[[{\w][^=]*=\s*(use[A-Z]\w*)\s*\(/;
const HOOK_NU = /^ {2}(use[A-Z]\w*)\s*\(/;
const RETOUR_DIRECT = /^ {2}return[\s(;]/;
const CONDITION = /^ {2}(?:if|switch)\s*\(/;
const RETOUR_CONDITIONNEL = /^ {2}if\s*\(.*\)\s*return[\s(;]/;
const RETOUR_IMBRIQUE = /^ {4}return[\s(;]/;
const FERMETURE = /^ {2}\}/;

function fichiers(dossier) {
  const sortie = [];
  for (const entree of readdirSync(dossier)) {
    const chemin = join(dossier, entree);
    if (statSync(chemin).isDirectory()) sortie.push(...fichiers(chemin));
    else if (entree.endsWith(".tsx")) sortie.push(chemin);
  }
  return sortie;
}

/** (name, first line, last line) per declaration at column zero. */
function blocs(lignes) {
  const debuts = [];
  lignes.forEach((ligne, index) => {
    const m = DECLARATION.exec(ligne);
    if (m) debuts.push([m[1], index]);
  });
  return debuts.map(([nom, debut], rang) => [
    nom,
    debut,
    rang + 1 < debuts.length ? debuts[rang + 1][1] : lignes.length,
  ]);
}

/** The line of the first early return in this body, or 0 when there is none. */
function premierRetourAnticipe(lignes, debut, fin) {
  let dansCondition = false;
  for (let index = debut; index < fin; index += 1) {
    const ligne = lignes[index];
    if (RETOUR_CONDITIONNEL.test(ligne) || RETOUR_DIRECT.test(ligne)) return index + 1;
    if (CONDITION.test(ligne)) {
      dansCondition = true;
      continue;
    }
    if (dansCondition) {
      if (RETOUR_IMBRIQUE.test(ligne)) return index + 1;
      if (FERMETURE.test(ligne)) dansCondition = false;
    }
  }
  return 0;
}

const problemes = [];
for (const chemin of fichiers(RACINE)) {
  const lignes = readFileSync(chemin, "utf-8").split("\n");
  for (const [nom, debut, fin] of blocs(lignes)) {
    const retour = premierRetourAnticipe(lignes, debut, fin);
    if (!retour) continue;
    for (let index = retour; index < fin; index += 1) {
      const trouve = HOOK_LIE.exec(lignes[index]) || HOOK_NU.exec(lignes[index]);
      if (trouve) problemes.push({ chemin, nom, ligne: index + 1, hook: trouve[1], retour });
    }
  }
}

if (problemes.length === 0) {
  console.log("hooks : aucun appel apres un retour anticipe");
  process.exit(0);
}

console.error("ECHEC : un hook est appele apres un retour anticipe.");
console.error("React refuse un rendu qui appelle un nombre de hooks different du precedent :");
console.error("la page deviendra blanche des que ses donnees arriveront.\n");
for (const p of problemes) {
  console.error(`  ${p.chemin}:${p.ligne}`);
  console.error(`    ${p.nom} appelle ${p.hook} apres le retour de la ligne ${p.retour}`);
  console.error("    Remontez ce hook au-dessus de ce retour.\n");
}
process.exit(1);
