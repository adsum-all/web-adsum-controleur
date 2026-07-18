// Thin client for the ADSUM API used by the controller scan app. The base URL is
// configurable so the app can point at the deployed API
// (https://adsum-api.vercel.app) or a local one.

const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "https://adsum-api.vercel.app";

export interface ControlEvent {
  id: string;
  titre: string;
  volet: string;
  debut: string;
  fin: string | null;
  lieu: string | null;
  session_ouverte: boolean;
}

export interface CheckinMember {
  id: string;
  matricule: string;
  nom: string | null;
  prenoms: string | null;
  nom_affichage?: string;
  est_berger?: boolean;
  nom_pastoral_affiche?: string | null;
  photo_url?: string | null;
  /** Function label (Responsable, Coordinatrice...), resolved by gender. */
  titre?: string | null;
  /** Category-aware appellation and its winning category (central resolver):
   * special function > title > function > particular. Preferred on the scan card. */
  appellation?: string | null;
  categorie_principale?: string | null;
}

export interface CheckinResult {
  deja_present: boolean;
  membre: CheckinMember;
  evenement_id: string;
  arrivee: string | null;
}

export interface VerifyResult {
  valid: boolean;
  reason?: string | null;
  matricule?: string | null;
  nom?: string | null;
  photo_url?: string | null;
}

export interface DirectoryMember {
  id: string;
  matricule: string;
  nom: string | null;
  prenoms: string | null;
  /** Civil display name (NOM Prenom1 [Prenom2]), never a function. */
  nom_affichage?: string;
  est_berger?: boolean;
  /** Gendered pastoral appellation (Berger/Bergere X), when applicable. */
  nom_pastoral_affiche?: string | null;
  commission: string | null;
  statut: string;
  /** Function label (Responsable, Coordinatrice...), resolved by gender. */
  titre?: string | null;
  /** Category-aware appellation and its winning category (central resolver). */
  appellation?: string | null;
  categorie_principale?: string | null;
}

export interface CheckoutResult {
  membre: CheckinMember;
  evenement_id: string;
  depart: string | null;
  deja_sorti: boolean;
}

// Discriminated error so the UI can react to the missing controller endpoints
// (404, built in parallel by the backend) with a clear message rather than a
// generic failure.
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }

  get notDeployed(): boolean {
    return this.status === 404;
  }
}

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function readDetail(res: Response): Promise<string | null> {
  try {
    const data = (await res.json()) as { detail?: unknown; reason?: unknown };
    const raw = data.detail ?? data.reason;
    if (typeof raw === "string") return raw;
    if (Array.isArray(raw) && raw.length > 0) {
      const first = raw[0] as { msg?: unknown };
      if (typeof first.msg === "string") return first.msg;
    }
    return null;
  } catch {
    return null;
  }
}

export function deviceId(): string {
  if (typeof localStorage === "undefined") return "";
  let id = localStorage.getItem("adsum.device.id");
  if (!id) {
    id = typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `dev-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem("adsum.device.id", id);
  }
  return id;
}

export interface LoginResult {
  otpRequired: boolean;
  token: string | null;
  canal: string | null;
}

function loginError(status: number): ApiError {
  if (status === 401) return new ApiError("Identifiants invalides ou mot de passe temporaire expiré", status);
  if (status === 429) return new ApiError("Trop de tentatives. Patientez quelques minutes, puis réessayez.", status);
  if (status === 400) return new ApiError("Code incorrect ou expiré. Vérifiez et réessayez.", status);
  return new ApiError("Service momentanément indisponible.", status);
}

export async function login(email: string, password: string): Promise<LoginResult> {
  const res = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Device-Id": deviceId() },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw loginError(res.status);
  const data = (await res.json()) as { otp_required?: boolean; access_token?: string | null; canal?: string | null };
  return { otpRequired: Boolean(data.otp_required), token: data.access_token ?? null, canal: data.canal ?? null };
}

export async function loginVerify(email: string, password: string, code: string, faireConfiance: boolean): Promise<string> {
  const res = await fetch(`${BASE}/api/v1/auth/login-verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Device-Id": deviceId() },
    body: JSON.stringify({ email, password, code, faire_confiance: faireConfiance }),
  });
  if (!res.ok) throw loginError(res.status);
  const data = (await res.json()) as { access_token?: string | null };
  if (!data.access_token) throw loginError(401);
  return data.access_token;
}

/** Control access is the controle.controler permission; the server enforces it on
 * every control endpoint. We confirm it at login so a granted account gets in and
 * an ungranted one gets a clear message instead of a broken screen. */
export async function aAccesControle(token: string): Promise<boolean> {
  const res = await fetch(`${BASE}/api/v1/membres/me/permissions`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return false;
  const data = (await res.json()) as { permissions?: string[] };
  return (data.permissions ?? []).includes("controle.controler");
}

export async function getControlEvents(token: string): Promise<ControlEvent[]> {
  const res = await fetch(`${BASE}/api/v1/controle/evenements`, {
    headers: authHeaders(token),
  });
  if (!res.ok) {
    if (res.status === 404) {
      throw new ApiError("Module de contrôle indisponible sur l'API.", 404);
    }
    throw new ApiError(
      res.status === 401 ? "Session expirée" : "Événements indisponibles",
      res.status,
    );
  }
  return (await res.json()) as ControlEvent[];
}

export async function checkin(
  token: string,
  qrToken: string,
  evenementId: string,
): Promise<CheckinResult> {
  const res = await fetch(`${BASE}/api/v1/controle/checkin`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ token: qrToken, evenement_id: evenementId }),
  });
  if (!res.ok) {
    if (res.status === 404) {
      throw new ApiError("Module de contrôle indisponible sur l'API.", 404);
    }
    if (res.status === 422) {
      throw new ApiError((await readDetail(res)) ?? "QR invalide ou expiré.", 422);
    }
    throw new ApiError(
      res.status === 401 ? "Session expirée" : "Pointage impossible.",
      res.status,
    );
  }
  return (await res.json()) as CheckinResult;
}

export async function verify(token: string, qrToken: string): Promise<VerifyResult> {
  const res = await fetch(`${BASE}/api/v1/controle/verify`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ token: qrToken }),
  });
  if (!res.ok) {
    if (res.status === 404) {
      throw new ApiError("Module de contrôle indisponible sur l'API.", 404);
    }
    throw new ApiError(
      res.status === 401 ? "Session expirée" : "Vérification impossible.",
      res.status,
    );
  }
  return (await res.json()) as VerifyResult;
}

export async function getDirectory(token: string, q?: string): Promise<DirectoryMember[]> {
  const url = new URL(`${BASE}/api/v1/controle/membres`);
  if (q) url.searchParams.set("q", q);
  const res = await fetch(url.toString(), { headers: authHeaders(token) });
  if (!res.ok) {
    if (res.status === 404) throw new ApiError("Module de contrôle indisponible sur l'API.", 404);
    throw new ApiError(res.status === 401 ? "Session expirée" : "Annuaire indisponible", res.status);
  }
  return (await res.json()) as DirectoryMember[];
}

export async function checkinManuel(
  token: string,
  membreId: string,
  evenementId: string,
): Promise<CheckinResult> {
  const res = await fetch(`${BASE}/api/v1/controle/checkin-manuel`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ membre_id: membreId, evenement_id: evenementId }),
  });
  if (!res.ok) {
    if (res.status === 404) throw new ApiError("Module de contrôle indisponible sur l'API.", 404);
    throw new ApiError(res.status === 401 ? "Session expirée" : "Pointage manuel impossible.", res.status);
  }
  return (await res.json()) as CheckinResult;
}

export async function checkout(
  token: string,
  qrToken: string,
  evenementId: string,
): Promise<CheckoutResult> {
  const res = await fetch(`${BASE}/api/v1/controle/checkout`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ token: qrToken, evenement_id: evenementId }),
  });
  if (!res.ok) {
    if (res.status === 404) throw new ApiError("Module de contrôle indisponible sur l'API.", 404);
    if (res.status === 422) throw new ApiError((await readDetail(res)) ?? "QR invalide.", 422);
    throw new ApiError(res.status === 401 ? "Session expirée" : "Sortie impossible.", res.status);
  }
  return (await res.json()) as CheckoutResult;
}

export function apiBaseUrl(): string {
  return BASE;
}
