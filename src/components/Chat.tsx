import { useState, useEffect, useRef } from 'react';
import { User } from 'firebase/auth';
import { db } from '../firebase';
import { collection, addDoc, getDocs, query, orderBy, limit } from 'firebase/firestore';
import { analyzeSymptoms, GeminiError, GeminiErrorType } from '../services/gemini';
import { handleFirestoreError, OperationType } from '../lib/firestore-errors';
import Markdown from 'react-markdown';
import { Send, Loader2, AlertCircle, Info, Paperclip, X, UserPlus, CheckCircle2 } from 'lucide-react';
import { cn } from '../lib/utils';
import { format } from 'date-fns';

interface ChatProps {
  user: User;
}

interface Message {
  role: 'user' | 'model';
  content: string;
  timestamp: string;
  file?: { name: string; type: string };
}

const MOCK_DOCTORS = [
  { id: 'dr_smith', name: 'Dr. Sarah Smith', specialty: 'General Physician', tags: ['fever', 'pain', 'flu', 'general'] },
  { id: 'dr_jones', name: 'Dr. Michael Jones', specialty: 'Cardiologist', tags: ['heart', 'chest', 'breathing', 'pressure'] },
  { id: 'dr_patel', name: 'Dr. Anita Patel', specialty: 'Neurologist', tags: ['headache', 'dizziness', 'numbness', 'seizure'] },
];

export function Chat({ user }: ChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [medicalContext, setMedicalContext] = useState<string>('');
  const [file, setFile] = useState<{ data: string, mimeType: string, name: string } | null>(null);
  const [showDoctorModal, setShowDoctorModal] = useState(false);
  const [consultationSent, setConsultationSent] = useState(false);
  const [lastCheckId, setLastCheckId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  useEffect(() => {
    const fetchMedicalContext = async () => {
      const path = `users/${user.uid}/medicalRecords`;
      try {
        const q = query(collection(db, path), orderBy('timestamp', 'desc'), limit(5));
        const snapshot = await getDocs(q);
        const records = snapshot.docs.map(doc => {
          const data = doc.data();
          return `[${data.recordType}] ${data.content} ${data.originalDiagnosis ? `(Diagnosis: ${data.originalDiagnosis})` : ''}`;
        });
        setMedicalContext(records.join('\n\n'));
      } catch (err) {
        console.error("Error fetching medical context:", err);
      }
    };
    fetchMedicalContext();
  }, [user.uid]);

  useEffect(() => {
    const fetchHistory = async () => {
      const path = `users/${user.uid}/symptomChecks`;
      try {
        const q = query(collection(db, path), orderBy('timestamp', 'desc'), limit(10));
        const snapshot = await getDocs(q);
        setHistory(snapshot.docs.map(doc => doc.data()));
      } catch (err) {
        console.error("Error fetching history:", err);
      }
    };
    fetchHistory();
  }, [user.uid]);

  const seedSampleHistory = async () => {
    const path = `users/${user.uid}/symptomChecks`;
    const samples = [
      { symptoms: "Persistent chest tightness and shortness of breath during exercise.", analysis: "Possible cardiovascular concern.", timestamp: new Date(Date.now() - 86400000 * 2).toISOString(), uid: user.uid },
      { symptoms: "Severe migraines with aura and sensitivity to light.", analysis: "Neurological symptoms observed.", timestamp: new Date(Date.now() - 86400000 * 5).toISOString(), uid: user.uid },
      { symptoms: "Seasonal allergies and mild fever.", analysis: "General flu-like symptoms.", timestamp: new Date(Date.now() - 86400000 * 10).toISOString(), uid: user.uid }
    ];

    try {
      setLoading(true);
      for (const sample of samples) {
        await addDoc(collection(db, path), sample);
      }
      // Refresh history
      const q = query(collection(db, path), orderBy('timestamp', 'desc'), limit(10));
      const snapshot = await getDocs(q);
      setHistory(snapshot.docs.map(doc => doc.data()));
      alert("Sample history seeded successfully!");
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, path);
    } finally {
      setLoading(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    if (selectedFile.size > 1024 * 1024) {
      setError("File size too large. Please upload files smaller than 1MB.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const base64Data = (reader.result as string).split(',')[1];
      setFile({
        data: base64Data,
        mimeType: selectedFile.type,
        name: selectedFile.name
      });
    };
    reader.readAsDataURL(selectedFile);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() && !file) return;
    if (loading) return;

    const userMessage: Message = {
      role: 'user',
      content: input,
      timestamp: new Date().toISOString(),
      file: file ? { name: file.name, type: file.mimeType } : undefined
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setLoading(true);
    setError(null);
    setConsultationSent(false);

    try {
      const historyForAI = messages.map(m => ({
        role: m.role,
        parts: [{ text: m.content }]
      }));

      const currentParts: any[] = [{ text: input }];
      if (file) {
        currentParts.push({
          inlineData: {
            data: file.data,
            mimeType: file.mimeType
          }
        });
      }

      historyForAI.push({ role: 'user', parts: currentParts });

      const analysis = await analyzeSymptoms(historyForAI, medicalContext);
      
      const aiMessage: Message = {
        role: 'model',
        content: analysis,
        timestamp: new Date().toISOString()
      };

      setMessages(prev => [...prev, aiMessage]);

      // Save to history (only the first interaction or the whole thread summary)
      if (messages.length === 0) {
        const path = `users/${user.uid}/symptomChecks`;
        try {
          const docRef = await addDoc(collection(db, path), {
            uid: user.uid,
            symptoms: input + (file ? ` [Attached: ${file.name}]` : ''),
            analysis,
            timestamp: new Date().toISOString(),
            isEmergency: analysis.toLowerCase().includes('emergency') || analysis.toLowerCase().includes('call 911')
          });
          setLastCheckId(docRef.id);
        } catch (err) {
          handleFirestoreError(err, OperationType.WRITE, path);
        }
      }
    } catch (err: any) {
      console.error("Analysis failed:", err);
      
      if (err instanceof GeminiError) {
        switch (err.type) {
          case GeminiErrorType.NETWORK:
            setError("Network error: Please check your internet connection and try again.");
            break;
          case GeminiErrorType.PROMPT:
            setError("Input error: " + err.message);
            break;
          case GeminiErrorType.API:
            setError("Service error: The AI service is currently unavailable. Please try again later.");
            break;
          default:
            setError("An unexpected error occurred. Please try again.");
        }
      } else {
        setError("Failed to analyze symptoms. Please try again.");
      }
    } finally {
      setLoading(false);
      setFile(null);
    }
  };

  const getRecommendedDoctors = () => {
    const currentText = messages.map(m => m.content).join(' ').toLowerCase();
    const historicalText = history.map(h => h.symptoms).join(' ').toLowerCase();
    const allText = currentText + ' ' + historicalText;
    
    return MOCK_DOCTORS.filter(doc => 
      doc.tags.some(tag => allText.includes(tag))
    );
  };

  const handleConnectToExpert = async (doctor: typeof MOCK_DOCTORS[0]) => {
    const path = `consultations`;
    try {
      await addDoc(collection(db, path), {
        uid: user.uid,
        doctorId: doctor.id,
        doctorName: doctor.name,
        checkId: lastCheckId || 'chat_session',
        transcript: messages.map(m => `${m.role === 'user' ? 'User' : 'MedAssist'}: ${m.content}`).join('\n\n'),
        status: 'pending',
        timestamp: new Date().toISOString()
      });
      setConsultationSent(true);
      setShowDoctorModal(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, path);
    }
  };

  const recommendedDoctors = getRecommendedDoctors();

  return (
    <div className="flex flex-col h-[calc(100vh-12rem)] max-w-5xl mx-auto">
      <header className="text-center mb-6">
        <h2 className="text-3xl font-serif text-[#1a1a1a]">MedAssist Chat</h2>
        <p className="text-[#5A5A40]/60 italic font-serif text-sm">
          Multi-turn health insights powered by Gemini & Google Search.
        </p>
      </header>

      <div 
        ref={scrollRef}
        className="flex-1 overflow-y-auto space-y-6 p-6 bg-white rounded-[32px] border border-[#5A5A40]/10 mb-6 scroll-smooth"
      >
        {messages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-center space-y-6 opacity-40">
            <Info className="w-12 h-12 text-[#5A5A40]" />
            <div className="space-y-2">
              <p className="font-serif italic text-lg max-w-xs">
                Start a conversation about your symptoms. I'll use my medical knowledge and search the web for the latest info.
              </p>
              {history.length === 0 && (
                <button 
                  onClick={seedSampleHistory}
                  className="text-xs font-bold uppercase tracking-widest text-[#5A5A40] hover:underline mt-4"
                >
                  Seed Sample History for Testing
                </button>
              )}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div 
            key={i}
            className={cn(
              "flex flex-col max-w-[85%] animate-in fade-in slide-in-from-bottom-2 duration-300",
              msg.role === 'user' ? "ml-auto items-end" : "mr-auto items-start"
            )}
          >
            <div 
              className={cn(
                "p-5 rounded-2xl font-serif text-lg leading-relaxed",
                msg.role === 'user' 
                  ? "bg-[#5A5A40] text-white rounded-tr-none" 
                  : "bg-[#f5f5f0] text-[#1a1a1a] rounded-tl-none border border-[#5A5A40]/5"
              )}
            >
              {msg.file && (
                <div className="mb-3 p-2 bg-black/10 rounded-lg flex items-center gap-2 text-xs">
                  <Paperclip className="w-3 h-3" />
                  <span>{msg.file.name}</span>
                </div>
              )}
              <Markdown>{msg.content}</Markdown>
            </div>
            <span className="text-[10px] text-[#5A5A40]/40 mt-1 uppercase tracking-widest">
              {format(new Date(msg.timestamp), 'h:mm a')}
            </span>
          </div>
        ))}

        {loading && (
          <div className="flex items-center gap-3 text-[#5A5A40]/60 italic font-serif animate-pulse">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span>MedAssist is thinking...</span>
          </div>
        )}

        {error && (
          <div className="p-4 bg-red-50 border border-red-100 rounded-2xl flex items-center gap-3 text-red-600 text-sm">
            <AlertCircle className="w-5 h-5" />
            <p>{error}</p>
          </div>
        )}
      </div>

      {recommendedDoctors.length > 0 && (
        <div className="mb-4 px-6 py-3 bg-[#5A5A40]/5 rounded-2xl border border-[#5A5A40]/10 flex items-center justify-between animate-in fade-in slide-in-from-top-2">
          <div className="flex items-center gap-3">
            <UserPlus className="w-5 h-5 text-[#5A5A40]" />
            <div className="flex flex-col">
              <span className="text-xs font-serif text-[#5A5A40]">Recommended Experts (Based on Chat & History):</span>
              <div className="flex gap-2 mt-1">
                {recommendedDoctors.slice(0, 3).map(doc => (
                  <span key={doc.id} className="text-[10px] bg-white px-2 py-0.5 rounded-full border border-[#5A5A40]/20 text-[#5A5A40] font-medium">
                    {doc.name}
                  </span>
                ))}
              </div>
            </div>
          </div>
          <button 
            onClick={() => setShowDoctorModal(true)}
            className="text-xs font-bold uppercase tracking-widest text-[#5A5A40] hover:underline"
          >
            Connect Now
          </button>
        </div>
      )}

      <form onSubmit={handleSubmit} className="relative">
        <div className="bg-white rounded-3xl p-2 shadow-lg border border-[#5A5A40]/10 flex items-end gap-2">
          <div className="flex-1 relative">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type your symptoms or questions..."
              className="w-full p-4 pr-12 rounded-2xl bg-[#f5f5f0]/50 border-none focus:ring-0 outline-none transition-all resize-none text-[#1a1a1a] placeholder-[#5A5A40]/40 font-serif text-lg min-h-[60px] max-h-[200px]"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit(e as any);
                }
              }}
              disabled={loading}
            />
            <div className="absolute right-2 bottom-2 flex items-center gap-1">
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                className="hidden"
                accept="image/*,application/pdf"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="p-2 text-[#5A5A40]/40 hover:text-[#5A5A40] transition-all"
              >
                <Paperclip className="w-5 h-5" />
              </button>
            </div>
          </div>
          <button
            type="submit"
            disabled={loading || (!input.trim() && !file)}
            className="bg-[#5A5A40] hover:bg-[#4A4A30] text-white p-4 rounded-2xl shadow-md transition-all active:scale-95 disabled:opacity-50"
          >
            <Send className="w-6 h-6" />
          </button>
        </div>
        {file && (
          <div className="absolute -top-10 left-0 flex items-center gap-2 bg-[#5A5A40] text-white px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-wider shadow-sm">
            <Paperclip className="w-3 h-3" />
            <span className="truncate max-w-[150px]">{file.name}</span>
            <button onClick={() => setFile(null)} className="hover:text-red-300">
              <X className="w-3 h-3" />
            </button>
          </div>
        )}
      </form>

      {showDoctorModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-[32px] w-full max-w-lg p-8 md:p-12 shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between mb-8">
              <h3 className="text-3xl font-serif text-[#1a1a1a]">Select an Expert</h3>
              <button onClick={() => setShowDoctorModal(false)} className="p-2 hover:bg-[#f5f5f0] rounded-full transition-all">
                <X className="w-6 h-6 text-[#5A5A40]" />
              </button>
            </div>
            
            <p className="text-[#5A5A40] mb-8 font-serif italic">
              The selected doctor will receive the full chat transcript for review.
            </p>

            <div className="space-y-4">
              {(recommendedDoctors.length > 0 ? recommendedDoctors : MOCK_DOCTORS).map((doc) => (
                <button
                  key={doc.id}
                  onClick={() => handleConnectToExpert(doc)}
                  className="w-full p-6 rounded-2xl border border-[#5A5A40]/10 hover:border-[#5A5A40] hover:bg-[#5A5A40]/5 transition-all text-left flex items-center justify-between group"
                >
                  <div>
                    <p className="font-serif text-xl text-[#1a1a1a]">{doc.name}</p>
                    <p className="text-sm text-[#5A5A40]/60">{doc.specialty}</p>
                  </div>
                  <ChevronRight className="w-5 h-5 text-[#5A5A40]/40 group-hover:translate-x-1 transition-transform" />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ChevronRight(props: any) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}
