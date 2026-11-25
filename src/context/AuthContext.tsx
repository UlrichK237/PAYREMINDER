import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  onAuthStateChanged,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  type User,
} from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  where,
  writeBatch,
  type Timestamp,
} from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from '../lib/firebase';
import type { TenantInvite, UserProfile } from '../types/payreminder';
import { DEFAULT_REMINDER_RULES, DEFAULT_TEMPLATES } from '../utils/defaults';
import { getCurrentDoualaMonth, normalizeCameroonPhone } from '../utils/formatters';

interface AuthContextValue {
  user: User | null;
  profile: UserProfile | null;
  pendingInvites: TenantInvite[];
  authReady: boolean;
  demoMode: boolean;
  demoDatasetKey: 'pagnes' | 'ecole';
  needsVerification: boolean;
  needsCompanySetup: boolean;
  errorMessage: string | null;
  clearError: () => void;
  loginWithEmail: (email: string, password: string) => Promise<void>;
  registerWithEmail: (params: {
    email: string;
    password: string;
    userName: string;
    companyName?: string;
    sector?: string;
    phone?: string;
  }) => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  resendVerificationEmail: () => Promise<void>;
  refreshAuthUser: () => Promise<void>;
  createCompanyForCurrentUser: (params: {
    userName: string;
    companyName: string;
    sector: string;
    phone: string;
  }) => Promise<void>;
  acceptInvite: (invite: TenantInvite) => Promise<void>;
  enterDemoMode: (dataset?: 'pagnes' | 'ecole') => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function tsToIso(val: unknown): string {
  if (val && typeof val === 'object' && 'toDate' in val && typeof (val as Timestamp).toDate === 'function') {
    return (val as Timestamp).toDate().toISOString();
  }
  return typeof val === 'string' ? val : new Date().toISOString();
}

function mapFirebaseAuthError(err: unknown): string {
  const code = (err as { code?: string })?.code || '';
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Email ou mot de passe incorrect.';
    case 'auth/email-already-in-use':
      return 'Un compte existe déjà avec cet email.';
    case 'auth/weak-password':
      return 'Le mot de passe doit contenir au moins 6 caractères.';
    case 'auth/invalid-email':
      return 'Adresse email invalide.';
    case 'auth/operation-not-allowed':
      return "La connexion par email/mot de passe n'est pas encore activée dans votre console Firebase (Authentication > Sign-in method). Utilisez le bouton Google ou le Mode Démonstration.";
    case 'auth/popup-closed-by-user':
      return 'Fenêtre de connexion fermée avant la fin.';
    default:
      return err instanceof Error ? err.message : 'Erreur d’authentification.';
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [pendingInvites, setPendingInvites] = useState<TenantInvite[]>([]);
  const [authReady, setAuthReady] = useState(false);
  const [demoMode, setDemoMode] = useState(false);
  const [demoDatasetKey, setDemoDatasetKey] = useState<'pagnes' | 'ecole'>('pagnes');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadUserWorkspace = useCallback(async (firebaseUser: User) => {
    if (!firebaseUser.emailVerified) {
      setProfile(null);
      setPendingInvites([]);
      return;
    }

    const profilePath = `userProfiles/${firebaseUser.uid}`;
    try {
      const snap = await getDoc(doc(db, 'userProfiles', firebaseUser.uid));
      if (snap.exists()) {
        const d = snap.data();
        setProfile({
          uid: d.uid,
          tenantId: d.tenantId,
          role: d.role,
          name: d.name,
          email: d.email,
          updatedAt: tsToIso(d.updatedAt),
        });
        setPendingInvites([]);
        return;
      }
      setProfile(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, profilePath);
    }

    if (firebaseUser.email) {
      const invitesPath = 'tenantInvites';
      try {
        const q = query(
          collection(db, 'tenantInvites'),
          where('email', '==', firebaseUser.email.toLowerCase()),
          where('status', '==', 'pending')
        );
        const invSnap = await getDocs(q);
        setPendingInvites(
          invSnap.docs.map((docItem) => {
            const data = docItem.data();
            return {
              id: docItem.id,
              tenantId: data.tenantId,
              tenantName: data.tenantName,
              email: data.email,
              name: data.name,
              role: 'staff',
              status: data.status,
              invitedBy: data.invitedBy,
              createdAt: tsToIso(data.createdAt),
            };
          })
        );
      } catch (error) {
        handleFirestoreError(error, OperationType.LIST, invitesPath);
      }
    }
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) {
        setDemoMode(false);
        void loadUserWorkspace(firebaseUser).finally(() => setAuthReady(true));
      } else {
        setProfile(null);
        setPendingInvites([]);
        setAuthReady(true);
      }
    });
    return () => unsubscribe();
  }, [loadUserWorkspace]);

  const clearError = () => setErrorMessage(null);

  const createCompanyForCurrentUser = useCallback(
    async (params: { userName: string; companyName: string; sector: string; phone: string }) => {
      const current = auth.currentUser;
      if (!current) throw new Error('Utilisateur non connecté.');
      if (!current.emailVerified) throw new Error('Veuillez vérifier votre adresse email avant de créer votre entreprise.');

      const normalizedPhone = normalizeCameroonPhone(params.phone.trim());
      const tenantId = `ten_${current.uid.slice(0, 10)}_${Date.now().toString(36)}`;
      const nowMonth = getCurrentDoualaMonth();
      const nowIso = new Date().toISOString();
      const batch = writeBatch(db);

      const tenantRef = doc(db, 'tenants', tenantId);
      batch.set(tenantRef, {
        name: params.companyName.trim().slice(0, 120),
        sector: params.sector.trim().slice(0, 80) || 'Commerce',
        phone: normalizedPhone,
        email: (current.email || '').toLowerCase(),
        plan: 'free',
        maxDebtors: 5,
        maxRemindersPerMonth: 30,
        remindersUsedThisMonth: 0,
        quotaResetMonth: nowMonth,
        subscriptionDate: nowIso,
        quietHoursStart: 20,
        quietHoursEnd: 7,
        timezone: 'Africa/Douala',
        autoEscalate: true,
        fallbackToSms: true,
        ownerId: current.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      const tenantUserRef = doc(db, 'tenants', tenantId, 'users', current.uid);
      batch.set(tenantUserRef, {
        tenantId,
        uid: current.uid,
        role: 'owner',
        name: params.userName.trim().slice(0, 120) || current.displayName || 'Propriétaire',
        email: (current.email || '').toLowerCase(),
        status: 'active',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      const userProfileRef = doc(db, 'userProfiles', current.uid);
      batch.set(userProfileRef, {
        uid: current.uid,
        tenantId,
        role: 'owner',
        name: params.userName.trim().slice(0, 120) || current.displayName || 'Propriétaire',
        email: (current.email || '').toLowerCase(),
        updatedAt: serverTimestamp(),
      });

      DEFAULT_REMINDER_RULES.forEach((rule, index) => {
        const ruleRef = doc(db, 'tenants', tenantId, 'reminderRules', `rule_${index + 1}`);
        batch.set(ruleRef, {
          ...rule,
          tenantId,
          updatedAt: serverTimestamp(),
        });
      });

      DEFAULT_TEMPLATES.forEach((tpl, index) => {
        const tplRef = doc(db, 'tenants', tenantId, 'messageTemplates', `tpl_${index + 1}`);
        batch.set(tplRef, {
          tenantId,
          tone: tpl.tone,
          channel: tpl.channel,
          body: tpl.body,
          ...(tpl.metaTemplateName ? { metaTemplateName: tpl.metaTemplateName } : {}),
          updatedAt: serverTimestamp(),
        });
      });

      try {
        await batch.commit();
        await loadUserWorkspace(current);
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, `tenants/${tenantId}`);
      }
    },
    [loadUserWorkspace]
  );

  const loginWithEmail = async (email: string, password: string) => {
    setErrorMessage(null);
    try {
      const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
      await loadUserWorkspace(cred.user);
    } catch (err) {
      const msg = mapFirebaseAuthError(err);
      setErrorMessage(msg);
      throw err;
    }
  };

  const registerWithEmail = async (params: {
    email: string;
    password: string;
    userName: string;
    companyName?: string;
    sector?: string;
    phone?: string;
  }) => {
    setErrorMessage(null);
    try {
      const cred = await createUserWithEmailAndPassword(auth, params.email.trim(), params.password);
      await updateProfile(cred.user, { displayName: params.userName.trim() });
      await sendEmailVerification(cred.user);
      if (params.companyName && params.phone) {
        try {
          sessionStorage.setItem(
            'payreminder_pending_company',
            JSON.stringify({
              userName: params.userName,
              companyName: params.companyName,
              sector: params.sector || 'Commerce',
              phone: params.phone,
            })
          );
        } catch {
          // Ignore sessionStorage errors
        }
      }
      setUser(cred.user);
    } catch (err) {
      const msg = mapFirebaseAuthError(err);
      setErrorMessage(msg);
      throw err;
    }
  };

  const loginWithGoogle = async () => {
    setErrorMessage(null);
    try {
      const provider = new GoogleAuthProvider();
      const cred = await signInWithPopup(auth, provider);
      await loadUserWorkspace(cred.user);
    } catch (err) {
      const msg = mapFirebaseAuthError(err);
      setErrorMessage(msg);
      throw err;
    }
  };

  const resendVerificationEmail = async () => {
    setErrorMessage(null);
    if (!auth.currentUser) return;
    try {
      await sendEmailVerification(auth.currentUser);
    } catch (err) {
      setErrorMessage(mapFirebaseAuthError(err));
    }
  };

  const refreshAuthUser = async () => {
    if (!auth.currentUser) return;
    await auth.currentUser.reload();
    const refreshed = auth.currentUser;
    setUser(refreshed);
    if (refreshed.emailVerified) {
      let pendingRaw: string | null = null;
      try {
        pendingRaw = sessionStorage.getItem('payreminder_pending_company');
      } catch {
        pendingRaw = null;
      }
      if (pendingRaw) {
        try {
          const parsed = JSON.parse(pendingRaw) as {
            userName: string;
            companyName: string;
            sector: string;
            phone: string;
          };
          sessionStorage.removeItem('payreminder_pending_company');
          await createCompanyForCurrentUser(parsed);
          return;
        } catch {
          // Falls back to manual setup screen
        }
      }
      await loadUserWorkspace(refreshed);
    }
  };

  const acceptInvite = async (invite: TenantInvite) => {
    const current = auth.currentUser;
    if (!current || !current.emailVerified) return;

    const batch = writeBatch(db);
    const tenantUserRef = doc(db, 'tenants', invite.tenantId, 'users', current.uid);
    batch.set(tenantUserRef, {
      tenantId: invite.tenantId,
      uid: current.uid,
      role: 'staff',
      name: current.displayName || invite.name,
      email: (current.email || invite.email).toLowerCase(),
      status: 'active',
      inviteId: invite.id,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    batch.update(doc(db, 'tenantInvites', invite.id), {
      status: 'accepted',
    });

    batch.set(doc(db, 'userProfiles', current.uid), {
      uid: current.uid,
      tenantId: invite.tenantId,
      role: 'staff',
      name: current.displayName || invite.name,
      email: (current.email || invite.email).toLowerCase(),
      updatedAt: serverTimestamp(),
    });

    try {
      await batch.commit();
      await loadUserWorkspace(current);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `tenants/${invite.tenantId}/users/${current.uid}`);
    }
  };

  const enterDemoMode = (dataset: 'pagnes' | 'ecole' = 'pagnes') => {
    setDemoDatasetKey(dataset);
    setDemoMode(true);
    setErrorMessage(null);
  };

  const logout = async () => {
    setDemoMode(false);
    setProfile(null);
    setPendingInvites([]);
    await signOut(auth);
  };

  const needsVerification = Boolean(user && !user.emailVerified && !demoMode);
  const needsCompanySetup = Boolean(user && user.emailVerified && !profile && !demoMode);

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        pendingInvites,
        authReady,
        demoMode,
        demoDatasetKey,
        needsVerification,
        needsCompanySetup,
        errorMessage,
        clearError,
        loginWithEmail,
        registerWithEmail,
        loginWithGoogle,
        resendVerificationEmail,
        refreshAuthUser,
        createCompanyForCurrentUser,
        acceptInvite,
        enterDemoMode,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth doit être utilisé dans un AuthProvider.');
  return ctx;
}
