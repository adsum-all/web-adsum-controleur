import { useState } from "react";

import { type ControlEvent } from "../api.js";
import { type DirectoryMember } from "../api.js";
import { searchDirectory } from "../directory.js";
import { enqueue, syncQueue } from "../queue.js";

interface ManualEntryProps {
  token: string;
  event: ControlEvent;
  online: boolean;
  onQueueChange: () => void;
}

export function ManualEntry({ token, event, online, onQueueChange }: ManualEntryProps): JSX.Element {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<DirectoryMember[]>([]);
  const [done, setDone] = useState<string | null>(null);

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
    enqueue({ kind: "manual", membreId: member.id, evenementId: event.id, matricule: member.matricule, label });
    onQueueChange();
    if (online) {
      await syncQueue(token);
      onQueueChange();
    }
    setDone(label);
    setQ("");
    setResults([]);
  }

  return (
    <div className="screen">
      <h1 className="screen-title">Saisie manuelle</h1>
      <p className="screen-sub">Méthode journalisée, fonctionne hors-ligne.</p>
      {done && <p className="banner banner-ok">Présence enregistrée : {done}</p>}
      <input
        className="search"
        value={q}
        onChange={(e) => onSearch(e.target.value)}
        placeholder="Nom, code, téléphone..."
        aria-label="Rechercher un membre"
      />
      <ul className="list">
        {results.map((m) => (
          <li key={m.id}>
            <button type="button" className="event" onClick={() => void record(m)}>
              <div className="event-main">
                <strong>{
                  (m.categorie_principale === "titre" || m.categorie_principale === "fonction_speciale") && m.appellation
                    ? m.appellation
                    : `${m.titre ? `${m.titre} ` : ""}${`${m.prenoms ?? ""} ${m.nom ?? ""}`.trim() || m.matricule}`
                }</strong>
                <span className="muted">
                  {m.matricule} . {m.commission ?? "-"}
                </span>
              </div>
              <span className="badge badge-ok">Pointer</span>
            </button>
          </li>
        ))}
      </ul>
      {q && results.length === 0 && <p className="muted">Aucun membre dans l'annuaire en cache.</p>}
    </div>
  );
}
