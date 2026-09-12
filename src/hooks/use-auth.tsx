import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useRouter } from "@tanstack/react-router";

export type AppRole = "orkestria_admin" | "tenant_admin" | "client";

export interface Profile {
  id: string;
  tenant_id: string | null;
  company_id: string | null;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
  tipo_usuario: string | null;
}

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  primary_color: string;
  logo_url: string | null;
}

interface AuthContextValue {
  loading: boolean;
  userId: string | null;
  profile: Profile | null;
  role: AppRole | null;
  tenant: Tenant | null;
  /** Usuário do tipo cliente: acesso somente leitura ao BI. */
  isCliente: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [role, setRole] = useState<AppRole | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const router = useRouter();

  // O provider era carregado 3x por abertura de tela: uma vez pelo
  // getSession inicial e outra a cada INITIAL_SESSION/TOKEN_REFRESHED do
  // Supabase. Perfil, papéis e logo do escritório não mudam entre esses
  // eventos, então uma carga por usuário basta.
  const carregadoRef = useRef<string | null>(null);
  const inflightRef = useRef<Promise<void> | null>(null);

  const load = async (uid: string | null, forcar = false) => {
    if (uid && !forcar) {
      if (carregadoRef.current === uid) return;
      if (inflightRef.current) return inflightRef.current;
    }
    const p = carregar(uid);
    if (uid) inflightRef.current = p;
    try {
      await p;
      carregadoRef.current = uid;
    } finally {
      inflightRef.current = null;
    }
  };

  const carregar = async (uid: string | null) => {
    if (!uid) {
      setProfile(null);
      setRole(null);
      setTenant(null);
      return;
    }
    const [{ data: prof }, { data: roles }] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", uid).maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", uid),
    ]);
    // Sessão órfã: token válido mas usuário foi excluído do banco.
    // Força logout para limpar o token antigo do navegador.
    if (!prof) {
      await supabase.auth.signOut();
      window.location.href = "/auth";
      return;
    }
    setProfile((prof as Profile) ?? null);
    const r = roles?.[0]?.role as AppRole | undefined;
    setRole(r ?? null);
    if (prof?.tenant_id) {
      const { data: t } = await supabase
        .from("tenants")
        .select("id,name,slug,primary_color,logo_url")
        .eq("id", prof.tenant_id)
        .maybeSingle();
      if (t) {
        let logoUrl = (t as any).logo_url as string | null;
        if (logoUrl && !/^https?:\/\//.test(logoUrl)) {
          const { data: signed } = await supabase.storage
            .from("tenant-logos")
            .createSignedUrl(logoUrl, 60 * 60 * 24 * 7);
          logoUrl = signed?.signedUrl ?? null;
        }
        setTenant({ ...(t as Tenant), logo_url: logoUrl });
      } else {
        setTenant(null);
      }
    } else {
      setTenant(null);
    }
  };

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(async ({ data }) => {
      const uid = data.session?.user.id ?? null;
      if (!mounted) return;
      setUserId(uid);
      await load(uid);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      // TOKEN_REFRESHED e INITIAL_SESSION não mudam quem é o usuário.
      if (event === "TOKEN_REFRESHED") return;
      const uid = session?.user.id ?? null;
      setUserId(uid);
      // Defer to avoid deadlocks
      setTimeout(() => {
        load(uid, event === "USER_UPDATED");
        if (event === "SIGNED_OUT") router.invalidate();
      }, 0);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isCliente = profile?.tipo_usuario === "cliente" || (role === "client" && profile?.tipo_usuario == null);

  const refresh = async () => {
    await load(userId, true);
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    // Hard reload garante que nenhum cache/token antigo permaneça
    window.location.href = "/auth";
  };

  return (
    <AuthContext.Provider value={{ loading, userId, profile, role, tenant, isCliente, refresh, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
