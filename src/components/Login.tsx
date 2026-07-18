import { useState } from "react";

import { ApiError, aAccesControle, login, loginVerify } from "../api.js";
import { PasswordInput } from "./PasswordInput.js";

interface LoginProps {
  onAuth: (token: string) => void;
}

export function Login({ onAuth }: LoginProps): JSX.Element {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [faireConfiance, setFaireConfiance] = useState(false);
  const [otpRequired, setOtpRequired] = useState(false);
  const [canal, setCanal] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function finaliser(token: string): Promise<void> {
    if (!(await aAccesControle(token))) {
      setError("Votre compte n'a pas encore l'accès contrôle. Contactez l'administration.");
      return;
    }
    onAuth(token);
  }

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (otpRequired) {
        await finaliser(await loginVerify(email, password, code.trim(), faireConfiance));
        return;
      }
      const result = await login(email, password);
      if (result.otpRequired) {
        setOtpRequired(true);
        setCanal(result.canal);
        return;
      }
      if (result.token) await finaliser(result.token);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Erreur réseau");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <div className="login-logo" aria-hidden="true">A</div>
      <div className="login-brand">ADSUM</div>
      <p className="login-sub">Contrôle des entrées, scan à la porte</p>
      <form onSubmit={submit} className="login-form">
        {!otpRequired && (
          <>
            <label>
              <span>Courriel</span>
              <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </label>
            <label>
              <span>Mot de passe</span>
              <PasswordInput autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </label>
          </>
        )}

        {otpRequired && (
          <>
            <p className="login-sub">
              Un code de vérification vous a été envoyé{canal === "telegram" ? " sur Telegram" : " par courriel"}. Saisissez-le pour continuer.
            </p>
            <label>
              <span>Code de vérification</span>
              <input type="text" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} required />
            </label>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input type="checkbox" checked={faireConfiance} onChange={(e) => setFaireConfiance(e.target.checked)} />
              <span>Faire confiance à cet appareil pendant 30 jours</span>
            </label>
          </>
        )}

        {error && <p className="login-error">{error}</p>}
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? "Connexion..." : otpRequired ? "Valider le code" : "Se connecter"}
        </button>
      </form>
      <p className="login-note">Accès réservé aux contrôleurs autorisés.</p>
    </div>
  );
}
