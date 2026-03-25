import { useState } from 'react';
import { signInWithPopup, GoogleAuthProvider } from 'firebase/auth';
import { auth } from '../firebase';
import { Stethoscope, AlertCircle } from 'lucide-react';

export function Auth() {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    const provider = new GoogleAuthProvider();
    setError(null);
    setLoading(true);
    try {
      await signInWithPopup(auth, provider);
    } catch (error: any) {
      console.error("Login failed:", error);
      if (error.code === 'auth/popup-closed-by-user') {
        setError("The login popup was closed before completion. Please try again.");
      } else if (error.code === 'auth/blocked-at-interaction') {
        setError("The login popup was blocked by your browser. Please allow popups for this site.");
      } else {
        setError("An error occurred during login. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f5f5f0] flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-[32px] p-8 md:p-12 shadow-sm border border-[#5A5A40]/10 text-center">
        <div className="w-16 h-16 bg-[#5A5A40] rounded-2xl flex items-center justify-center mx-auto mb-8 shadow-lg shadow-[#5A5A40]/20">
          <Stethoscope className="w-8 h-8 text-white" />
        </div>
        
        <h1 className="text-4xl font-serif text-[#1a1a1a] mb-4">MedAssist</h1>
        <p className="text-[#5A5A40] mb-8 leading-relaxed">
          Your AI-powered health symptom checker. Get empathetic insights and manage your medical records securely.
        </p>

        {error && (
          <div className="mb-8 p-4 bg-red-50 border border-red-200 rounded-2xl flex items-center gap-3 text-red-700 text-sm text-left">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <p>{error}</p>
          </div>
        )}

        <button
          onClick={handleLogin}
          disabled={loading}
          className="w-full bg-[#5A5A40] hover:bg-[#4A4A30] text-white font-medium py-4 px-6 rounded-full transition-all duration-200 flex items-center justify-center gap-3 shadow-md hover:shadow-lg disabled:opacity-50"
        >
          {loading ? (
            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : (
            <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" className="w-5 h-5" alt="Google" />
          )}
          {loading ? "Connecting..." : "Continue with Google"}
        </button>

        <p className="mt-8 text-xs text-[#5A5A40]/60 italic font-serif">
          "Educating users about possible conditions, not a replacement for professional medical advice."
        </p>
      </div>
    </div>
  );
}
