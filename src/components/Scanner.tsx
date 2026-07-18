import { BrowserQRCodeReader, type IScannerControls } from "@zxing/browser";
import { useEffect, useRef, useState } from "react";

import { type ControlEvent, verify } from "../api.js";
import { findById } from "../directory.js";
import { enqueue, pendingCount, syncQueue } from "../queue.js";
import { verifyQrToken } from "../qr.js";

interface ScannerProps {
  token: string;
  event: ControlEvent;
  online: boolean;
  onQueueChange: () => void;
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
    }
  | { kind: "invalid"; reason: string }
  | { kind: "saved"; label: string };

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
    });
    // When online, ask the API for the signed identity photo. This never blocks
    // the door: the card renders immediately with the initials fallback and the
    // photo is swapped in as soon as it arrives. Offline, this call is skipped
    // and the initials placeholder stays.
    if (online) {
      void verify(token, qrToken)
        .then((result) => {
          const photoUrl = result.photo_url ?? null;
          if (!photoUrl) return;
          setView((current) =>
            current.kind === "valid" && current.membreId === membreId
              ? { ...current, photoUrl }
              : current,
          );
        })
        .catch(() => undefined);
    }
  }

  async function confirmPresence(v: Extract<View, { kind: "valid" }>): Promise<void> {
    enqueue({
      kind: "qr",
      qrToken: v.qrToken,
      evenementId: event.id,
      membreId: v.membreId,
      matricule: v.matricule,
      label: v.label,
    });
    onQueueChange();
    if (online) {
      await syncQueue(token);
      onQueueChange();
    }
    setView({ kind: "saved", label: v.label });
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
        <p className="result-id">{view.matricule} . VÉRIFIÉ</p>
        <p className="muted">{event.titre}</p>
        <button type="button" className="btn btn-ok" onClick={() => void confirmPresence(view)}>
          Confirmer la présence
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

  if (view.kind === "saved") {
    return (
      <div className="result result-saved">
        <div className="result-glyph result-ok">OK</div>
        <h2>Présence enregistrée</h2>
        <p className="muted">
          {view.label} . {event.titre}
        </p>
        <p className="muted small">file {pendingCount()} . {online ? "synchronisée" : "synchro différée"}</p>
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
