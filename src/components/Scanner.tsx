import { BrowserQRCodeReader, type IScannerControls } from "@zxing/browser";
import { useEffect, useRef, useState } from "react";

import { type ControlEvent, verify } from "../api.js";
import { findById } from "../directory.js";
import { enqueue, pendingCount, relire, syncQueue } from "../queue.js";
import { verifyQrToken } from "../qr.js";

interface ScannerProps {
  token: string;
  event: ControlEvent;
  online: boolean;
  onQueueChange: () => void;
}

/** What the server said about the file behind the badge, once it has answered. */
interface EtatProfil {
  verdict: "autorise" | "alerte" | "refuse";
  raison: string | null;
  statut: string | null;
  statutInscription: string | null;
  identiteVerifiee: boolean;
}

type View =
  | { kind: "scan" }
  | {
      kind: "valid";
      membreId: string;
      label: string;
      pastoral: string | null;
      fonction: string | null;
      matricule: string;
      qrToken: string;
      photoUrl: string | null;
      /** Null until the server answers, or offline where it never will. */
      etat: EtatProfil | null;
    }
  | { kind: "invalid"; reason: string }
  | { kind: "saved"; label: string; alerte: string | null; differe: boolean }
  // A refusal deserves its own screen. Presenting it as a success is how a person
  // walks in while no attendance is ever written.
  | { kind: "echec"; label: string; raison: string };

export function Scanner({ token, event, online, onQueueChange }: ScannerProps): JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const [view, setView] = useState<View>({ kind: "scan" });
  const [camError, setCamError] = useState<string | null>(null);
  const [manual, setManual] = useState("");
  const [photoFailed, setPhotoFailed] = useState(false);

  useEffect(() => {
    if (view.kind !== "scan") return;
    let stopped = false;
    const reader = new BrowserQRCodeReader();
    reader
      .decodeFromVideoDevice(undefined, videoRef.current ?? undefined, (result) => {
        if (result && !stopped) {
          stopped = true;
          controlsRef.current?.stop();
          handleToken(result.getText());
        }
      })
      .then((controls) => {
        if (stopped) controls.stop();
        else controlsRef.current = controls;
      })
      .catch(() => setCamError("Caméra indisponible. Utilisez la saisie du code ou le mode manuel."));
    return () => {
      stopped = true;
      controlsRef.current?.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.kind]);

  function handleToken(qrToken: string): void {
    const v = verifyQrToken(qrToken);
    if (!v.valid || !v.membreId) {
      setView({ kind: "invalid", reason: v.reason ?? "QR non valide" });
      return;
    }
    const member = findById(v.membreId);
    // Civil name first (NOM Prenom1 [Prenom2]); the function and the pastoral
    // (Berger/Bergere) appellation are shown separately, never in the name.
    const civil =
      member?.nom_affichage?.trim() ||
      (member ? `${member.prenoms ?? ""} ${member.nom ?? ""}`.trim() : "") ||
      member?.matricule ||
      "Membre";
    const membreId = v.membreId;
    setPhotoFailed(false);
    setView({
      kind: "valid",
      membreId,
      label: civil,
      // Category precedence: a title or special function takes the highlighted
      // (pastoral) line via the resolved appellation; ordinary functions keep the
      // secondary line. Falls back to the legacy fields for the offline cache.
      pastoral:
        (member?.categorie_principale === "titre" || member?.categorie_principale === "fonction_speciale") && member?.appellation
          ? member.appellation
          : member?.est_berger
            ? (member?.nom_pastoral_affiche ?? null)
            : null,
      fonction:
        member?.categorie_principale === "titre" || member?.categorie_principale === "fonction_speciale"
          ? null
          : (member?.titre ?? null),
      matricule: member?.matricule ?? membreId.slice(0, 8),
      qrToken,
      photoUrl: null,
      etat: null,
    });
    // When online, ask the API what it makes of this badge. This never blocks the
    // door: the card renders immediately from the local cache, and the server's
    // answer arrives a moment later. Offline it never comes, and the card says so.
    //
    // The answer carries three things and all three are used. The photograph, which
    // is what the controller compares with the face. The signature verdict, which is
    // the only authority on expiry: the local check runs against the terminal's own
    // clock, so a device set to the wrong time accepts an expired badge and says
    // VÉRIFIÉ. And the state of the file, because a genuine badge says nothing about
    // whether the organisation still counts this person as a member.
    if (online) {
      void verify(token, qrToken)
        .then((result) => {
          if (!result.valid) {
            setView((current) =>
              current.kind === "valid" && current.membreId === membreId
                ? { kind: "invalid", reason: result.reason ?? "jeton refusé par le serveur" }
                : current,
            );
            return;
          }
          const etat: EtatProfil = {
            verdict: (result.verdict as EtatProfil["verdict"]) ?? "autorise",
            raison: result.verdict_raison ?? null,
            statut: result.statut ?? null,
            statutInscription: result.statut_inscription ?? null,
            identiteVerifiee: Boolean(result.identite_verifiee),
          };
          setView((current) =>
            current.kind === "valid" && current.membreId === membreId
              ? { ...current, photoUrl: result.photo_url ?? current.photoUrl, etat }
              : current,
          );
        })
        .catch(() => undefined);
    }
  }

  async function confirmPresence(v: Extract<View, { kind: "valid" }>): Promise<void> {
    const item = enqueue(
      {
        kind: "qr",
        qrToken: v.qrToken,
        evenementId: event.id,
        membreId: v.membreId,
        matricule: v.matricule,
        label: v.label,
      },
      token,
    );
    onQueueChange();

    // Offline, the entry waits and the screen says so. Nothing has reached the
    // server yet, and calling that "recorded" would be a lie the controller acts on.
    if (!online) {
      setView({ kind: "saved", label: v.label, alerte: null, differe: true });
      return;
    }

    await syncQueue(token);
    onQueueChange();

    // Read back what became of THIS entry. Previously the outcome was discarded and
    // the success screen shown unconditionally: on a refusal the queue emptied, the
    // banner read "file 0, synchronisée", and no attendance existed anywhere.
    const apres = relire(item.id);
    if (apres?.status === "rejected") {
      setView({
        kind: "echec",
        label: v.label,
        raison: apres.error ?? "Le serveur a refusé ce pointage.",
      });
      return;
    }
    setView({
      kind: "saved",
      label: v.label,
      alerte: v.etat?.verdict === "alerte" ? v.etat.raison : null,
      differe: apres?.status !== "synced",
    });
  }

  if (view.kind === "valid") {
    const showPhoto = view.photoUrl !== null && !photoFailed;
    return (
      <div className="result result-valid">
        {showPhoto ? (
          <img
            className="result-photo"
            src={view.photoUrl ?? ""}
            alt="Photo du membre"
            onError={() => setPhotoFailed(true)}
          />
        ) : (
          <div className="result-avatar">{initials(view.label)}</div>
        )}
        <h2>{view.label}</h2>
        {view.pastoral && <p className="result-pastoral">{view.pastoral}</p>}
        {view.fonction && <p className="result-fonction">{view.fonction}</p>}
        {/* The badge and the file are two different things and the card says both.
            A signature that checks out only proves the badge is genuine. */}
        <p className="result-id">
          {view.matricule} . {view.etat ? "QR VALIDÉ PAR LE SERVEUR" : online ? "VÉRIFICATION..." : "QR VÉRIFIÉ HORS LIGNE"}
        </p>
        <EtatDuProfil etat={view.etat} online={online} />
        <p className="muted">{event.titre}</p>
        <button
          type="button"
          className="btn btn-ok"
          disabled={view.etat?.verdict === "refuse"}
          onClick={() => void confirmPresence(view)}
        >
          {view.etat?.verdict === "refuse" ? "Pointage impossible" : "Confirmer la présence"}
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => setView({ kind: "scan" })}>
          Refuser
        </button>
      </div>
    );
  }

  if (view.kind === "invalid") {
    return (
      <div className="result result-invalid">
        <div className="result-glyph result-bad">!</div>
        <h2>QR non valide</h2>
        <p className="muted">{view.reason}. Aucune présence enregistrée.</p>
        <button type="button" className="btn btn-primary" onClick={() => setView({ kind: "scan" })}>
          Réessayer le scan
        </button>
      </div>
    );
  }

  if (view.kind === "echec") {
    return (
      <div className="result result-invalid">
        <div className="result-glyph result-bad">!</div>
        <h2>Pointage refusé</h2>
        <p className="muted">{view.label}</p>
        <p className="result-motif">{view.raison}</p>
        <p className="muted small">Aucune présence n'a été enregistrée pour cette personne.</p>
        <button type="button" className="btn btn-primary" onClick={() => setView({ kind: "scan" })}>
          Scanner le suivant
        </button>
      </div>
    );
  }

  if (view.kind === "saved") {
    return (
      <div className="result result-saved">
        <div className="result-glyph result-ok">OK</div>
        <h2>{view.differe ? "Présence en attente d'envoi" : "Présence enregistrée"}</h2>
        <p className="muted">
          {view.label} . {event.titre}
        </p>
        {/* A warning that did not block still has to be seen: a file whose
            registration is not approved is something the office will want to know. */}
        {view.alerte && <p className="result-alerte">{view.alerte}</p>}
        <p className="muted small">
          {view.differe
            ? `file ${pendingCount()} . sera envoyée dès le retour du réseau`
            : `file ${pendingCount()} . enregistrée sur le serveur`}
        </p>
        <button type="button" className="btn btn-ok" onClick={() => setView({ kind: "scan" })}>
          Scanner le suivant
        </button>
      </div>
    );
  }

  return (
    <div className="scanner">
      <div className="scanner-head">
        <span className="muted">{event.titre}</span>
        <span className={`badge ${online ? "badge-ok" : "badge-mut"}`}>
          {online ? "EN LIGNE" : "HORS-LIGNE"} . {pendingCount()} EN FILE
        </span>
      </div>
      <div className="scanner-frame">
        <video ref={videoRef} className="scanner-video" muted playsInline />
        <div className="scanner-reticle" aria-hidden="true" />
      </div>
      <p className="muted center">Visez le QR du membre</p>
      {camError && <p className="banner banner-error">{camError}</p>}
      <form
        className="scanner-manual"
        onSubmit={(e) => {
          e.preventDefault();
          if (manual.trim()) handleToken(manual.trim());
        }}
      >
        <input
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          placeholder="Coller un code QR (ADSUM1...)"
          aria-label="Code QR"
        />
        <button type="submit" className="btn btn-ghost">
          Vérifier
        </button>
      </form>
    </div>
  );
}

function initials(label: string): string {
  return label.slice(0, 2).toUpperCase();
}

/**
 * The state of the file behind the badge, as the server sees it.
 *
 * Shown before the controller confirms, because that is the moment the decision is
 * taken. A suspended member, an unfinished registration and a fully approved file all
 * produced the same green card before this, and the presence was written in silence.
 */
function EtatDuProfil({ etat, online }: { etat: EtatProfil | null; online: boolean }): JSX.Element {
  if (!online) {
    return (
      <p className="result-etat result-etat-inconnu">
        Hors ligne : l'état du dossier n'a pas pu être vérifié.
      </p>
    );
  }
  if (!etat) {
    return <p className="result-etat result-etat-inconnu">Vérification du dossier...</p>;
  }
  const classe =
    etat.verdict === "refuse" ? "result-etat-refuse"
      : etat.verdict === "alerte" ? "result-etat-alerte" : "result-etat-ok";
  return (
    <div className={`result-etat ${classe}`}>
      <strong>
        {etat.verdict === "refuse" ? "Dossier fermé"
          : etat.verdict === "alerte" ? "À vérifier" : "Dossier validé"}
      </strong>
      <span>{etat.raison}</span>
      <span className="result-etat-detail">
        Statut {etat.statut ?? "inconnu"} . inscription {etat.statutInscription ?? "inconnue"}
        {" . "}identité {etat.identiteVerifiee ? "vérifiée" : "non vérifiée"}
      </span>
    </div>
  );
}
