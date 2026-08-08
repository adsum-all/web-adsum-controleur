import { useState } from "react";

import { type ControlEvent } from "../api.js";
import { type DirectoryMember } from "../api.js";
import { searchDirectory } from "../directory.js";
import { enqueue, relire, syncQueue } from "../queue.js";

interface ManualEntryProps {
  token: string;
  event: ControlEvent;
  online: boolean;
  onQueueChange: () => void;
}

/** Whether the file behind a name is one the organisation still counts.
 *
 * Read from the cached directory, which already carries the state and never showed
 * it: a suspended member appeared in this list exactly like an approved one and could
 * be checked in with a tap. The server refuses those now, but a controller finding
 * out only after tapping is a controller who has already told somebody to come in. */
function etatLocal(m: DirectoryMember): { ton: "ok" | "alerte" | "refuse"; libelle: string } {
  const statut = (m.statut ?? "").toLowerCase();
  if (statut && statut !== "actif") {
    return { ton: "refuse", libelle: `Fiche ${statut}` };
  }
  return { ton: "ok", libelle: "Fiche active" };
}

export function ManualEntry({ token, event, online, onQueueChange }: ManualEntryProps): JSX.Element {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<DirectoryMember[]>([]);
  const [done, setDone] = useState<string | null>(null);
  const [echec, setEchec] = useState<string | null>(null);
  const [differe, setDiffere] = useState(false);

  function onSearch(value: string): void {
    setQ(value);
    setResults(searchDirectory(value));
  }

  async function record(member: DirectoryMember): Promise<void> {
    const nomComplet = `${member.prenoms ?? ""} ${member.nom ?? ""}`.trim() || member.matricule;
    // A title or special function stands on its own (already the full appellation);
    // an ordinary function prefixes the civil name.
    const label =
      (member.categorie_principale === "titre" || member.categorie_principale === "fonction_speciale") && member.appellation
        ? member.appellation
        : member.titre
          ? `${member.titre} ${nomComplet}`
          : nomComplet;

    setDone(null);
    setEchec(null);
    const item = enqueue(
      { kind: "manual", membreId: member.id, evenementId: event.id, matricule: member.matricule, label },
      token,
    );
    onQueueChange();
    setQ("");
    setResults([]);

    if (!online) {
      setDone(label);
      setDiffere(true);
      return;
    }

    await syncQueue(token);
    onQueueChange();

    // Report what became of this entry rather than that the request finished. The
    // success banner used to appear unconditionally: on a refusal the controller read
    // "Présence enregistrée" while nothing had been written.
    const apres = relire(item.id);
    if (apres?.status === "rejected") {
      setEchec(`${label} : ${apres.error ?? "le serveur a refusé ce pointage"}`);
      return;
    }
    setDone(label);
    setDiffere(apres?.status !== "synced");
  }

  return (
    <div className="screen">
      <h1 className="screen-title">Saisie manuelle</h1>
      <p className="screen-sub">Méthode journalisée, fonctionne hors-ligne.</p>
      {echec && <p className="banner banner-error">Pointage refusé. {echec}</p>}
      {done && (
        <p className="banner banner-ok">
          {differe ? "Présence en attente d'envoi" : "Présence enregistrée"} : {done}
        </p>
      )}
      <input
        className="search"
        value={q}
        onChange={(e) => onSearch(e.target.value)}
        placeholder="Nom, code, téléphone..."
        aria-label="Rechercher un membre"
      />
      <ul className="list">
        {results.map((m) => {
          const etat = etatLocal(m);
          return (
            <li key={m.id}>
              <button
                type="button"
                className="event"
                disabled={etat.ton === "refuse"}
                onClick={() => void record(m)}
              >
                <div className="event-main">
                  <strong>{
                    (m.categorie_principale === "titre" || m.categorie_principale === "fonction_speciale") && m.appellation
                      ? m.appellation
                      : `${m.titre ? `${m.titre} ` : ""}${`${m.prenoms ?? ""} ${m.nom ?? ""}`.trim() || m.matricule}`
                  }</strong>
                  <span className="muted">
                    {m.matricule} . {m.commission ?? "-"}
                  </span>
                  <span className={`etat-fiche etat-fiche-${etat.ton}`}>{etat.libelle}</span>
                </div>
                <span className={`badge ${etat.ton === "refuse" ? "badge-mut" : "badge-ok"}`}>
                  {etat.ton === "refuse" ? "Bloqué" : "Pointer"}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {q && results.length === 0 && <p className="muted">Aucun membre dans l'annuaire en cache.</p>}
    </div>
  );
}
