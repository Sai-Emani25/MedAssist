import { useState, useEffect } from 'react';
import { onAuthStateChanged, User, signInWithPopup, GoogleAuthProvider, signOut } from 'firebase/auth';
import { auth, db } from './firebase';
import { doc, getDoc, setDoc, getDocFromServer } from 'firebase/firestore';
import { Navigation } from './components/Navigation';
import { Chat } from './components/Chat';
import { Records } from './components/Records';
import { History } from './components/History';
import { Experts } from './components/Experts';
import { Auth } from './components/Auth';
import { Loader2, AlertCircle } from 'lucide-react';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'chat' | 'records' | 'history' | 'experts'>('chat');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        // Sync user profile
        const userRef = doc(db, 'users', user.uid);
        try {
          const userDoc = await getDoc(userRef);
          if (!userDoc.exists()) {
            await setDoc(userRef, {
              uid: user.uid,
              displayName: user.displayName,
              email: user.email,
              createdAt: new Date().toISOString()
            });
          }
        } catch (err) {
          console.error("Error syncing user profile:", err);
        }
        setUser(user);
      } else {
        setUser(null);
      }
      setLoading(false);
    });

    // Test connection to Firestore
    const testConnection = async () => {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if (error instanceof Error && error.message.includes('the client is offline')) {
          setError("Please check your Firebase configuration. The client appears to be offline.");
        }
      }
    };
    testConnection();

    return () => unsubscribe();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#f5f5f0] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-[#5A5A40]" />
      </div>
    );
  }

  if (!user) {
    return <Auth />;
  }

  return (
    <div className="min-h-screen bg-[#f5f5f0] flex flex-col md:flex-row">
      <Navigation activeTab={activeTab} setActiveTab={setActiveTab} user={user} />
      
      <main className="flex-1 p-4 md:p-8 overflow-y-auto">
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl flex items-center gap-3 text-red-700">
            <AlertCircle className="w-5 h-5" />
            <p>{error}</p>
          </div>
        )}

        <div className="max-w-4xl mx-auto">
          {activeTab === 'chat' && <Chat user={user} />}
          {activeTab === 'records' && <Records user={user} />}
          {activeTab === 'history' && <History user={user} />}
          {activeTab === 'experts' && <Experts user={user} />}
        </div>
      </main>
    </div>
  );
}
