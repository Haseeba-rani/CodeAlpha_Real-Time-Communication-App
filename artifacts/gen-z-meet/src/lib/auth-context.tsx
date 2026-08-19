import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { setAuthTokenGetter, setUserIdGetter } from "@workspace/api-client-react";
import { auth } from "@/lib/firebase";

type AuthContextValue = {
  user: User | null;
  loading: boolean;
};

const AuthContext = createContext<AuthContextValue>({ user: null, loading: true });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setAuthTokenGetter(() => auth.currentUser?.getIdToken() ?? null);
    setUserIdGetter(() => {
      if (auth.currentUser?.uid) return auth.currentUser.uid;
      if (typeof window !== 'undefined') {
        let gid = sessionStorage.getItem('genz_meet_guest_id');
        if (!gid) {
          gid = `guest_${Math.random().toString(36).slice(2, 10)}`;
          sessionStorage.setItem('genz_meet_guest_id', gid);
        }
        return gid;
      }
      return null;
    });
    return onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setLoading(false);
    });
  }, []);

  const value = useMemo(() => ({ user, loading }), [loading, user]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}