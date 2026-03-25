import { useState, useEffect, useRef } from 'react';
import { User } from 'firebase/auth';
import { db } from '../firebase';
import { collection, addDoc, getDocs, query, orderBy, limit, updateDoc, doc } from 'firebase/firestore';
import { analyzeSymptoms, generateChatTitle, GeminiError, GeminiErrorType } from '../services/gemini';
import { handleFirestoreError, OperationType } from '../lib/firestore-errors';
import Markdown from 'react-markdown';
import { Send, Loader2, AlertCircle, Info, Paperclip, X, UserPlus, PlusCircle, Search } from 'lucide-react';
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
  const [lastCheckId, setLastCheckId] = useState<string | null>(() => localStorage.getItem(`medassist_last_check_id_${user.uid}`));
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Load messages from localStorage on mount
  useEffect(() => {
    const savedMessages = localStorage.getItem(`medassist_chat_messages_${user.uid}`);
    if (savedMessages) {
      try {
        setMessages(JSON.parse(savedMessages));
      } catch (e) {
        console.error("Failed to parse saved messages", e);
      }
    }
  }, [user.uid]);

  // Autosave messages to localStorage
  useEffect(() => {
    if (messages.length > 0) {
      localStorage.setItem(`medassist_chat_messages_${user.uid}`, JSON.stringify(messages));
    }
    if (lastCheckId) {
      localStorage.setItem(`medassist_last_check_id_${user.uid}`, lastCheckId);
    }
  }, [messages, lastCheckId, user.uid]);

  const startNewChat = () => {
    setMessages([]);
    setLastCheckId(null);
    localStorage.removeItem(`medassist_chat_messages_${user.uid}`);
    localStorage.removeItem(`medassist_last_check_id_${user.uid}`);
    setError(null);
  };

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

    if (selectedFile.size > 256 * 1024 * 1024) {
      setError("File size too large. Please upload files smaller than 256MB.");
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

      const newMessages = [...messages, userMessage, aiMessage];
      setMessages(newMessages);

      // Save to history
      const path = `users/${user.uid}/symptomChecks`;
      try {
        if (!lastCheckId) {
          // Generate a title for the new conversation
          const title = await generateChatTitle(newMessages);
          
          const docRef = await addDoc(collection(db, path), {
            uid: user.uid,
            title,
            symptoms: input + (file ? ` [Attached: ${file.name}]` : ''),
            analysis,
            timestamp: new Date().toISOString(),
            isEmergency: analysis.toLowerCase().includes('emergency') || analysis.toLowerCase().includes('call 911'),
            messages: newMessages // Store full conversation
          });
          setLastCheckId(docRef.id);
        } else {
          // Update existing session
          const docRef = doc(db, path, lastCheckId);
          
          // Optionally update title if conversation has grown significantly
          const updateData: any = {
            analysis, // Latest analysis
            messages: newMessages
          };
          
          if (newMessages.length === 4) { // Update title after a few exchanges for better accuracy
            updateData.title = await generateChatTitle(newMessages);
          }
          
          await updateDoc(docRef, updateData);
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, path);
      }
    } catch (err: any) {
      console.error("Analysis failed:", err);
      
      if (err instanceof GeminiError) {
        switch (err.type) {
          case GeminiErrorType.NETWORK:
            setError(err.message);
            break;
          case GeminiErrorType.PROMPT:
            setError(err.message);
            break;
          case GeminiErrorType.API:
            setError(err.message);
            break;
          default:
            setError(err.message || "An unexpected error occurred. Please try again.");
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
        doctorSpecialty: doctor.specialty,
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
    <div className="flex flex-col max-w-5xl mx-auto w-full">
      <header className="text-center mb-8 relative">
        <div className="flex items-center justify-center gap-4 mb-2">
          <h2 className="text-4xl font-sans font-bold text-slate-900 tracking-tight">MedAssist Chat</h2>
          <div className="flex items-center gap-2">
            {showSearch ? (
              <div className="flex items-center bg-white border border-slate-200 rounded-full px-3 py-1 shadow-sm animate-in fade-in slide-in-from-right-2">
                <Search className="w-3 h-3 text-slate-400" />
                <input 
                  autoFocus
                  type="text" 
                  placeholder="Search chat..." 
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="bg-transparent border-none focus:ring-0 text-xs w-32 font-sans"
                />
                <button onClick={() => { setShowSearch(false); setSearchQuery(''); }}>
                  <X className="w-3 h-3 text-slate-400 hover:text-slate-600" />
                </button>
              </div>
            ) : (
              <button 
                onClick={() => setShowSearch(true)}
                className="p-2 hover:bg-slate-100 rounded-full transition-all text-slate-400"
                title="Search conversation"
              >
                <Search className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>
        <p className="text-slate-500 font-sans text-sm">
          Multi-turn health insights powered by Gemini & Google Search.
        </p>
        <button 
          onClick={startNewChat}
          className="absolute right-0 top-0 flex items-center gap-2 bg-white border border-slate-200 px-4 py-2 rounded-2xl text-xs font-bold uppercase tracking-widest text-slate-600 hover:bg-slate-50 transition-all shadow-sm"
        >
          <PlusCircle className="w-4 h-4" />
          New Chat
        </button>
      </header>

      <div className="flex flex-col bg-white rounded-[32px] border border-slate-200 shadow-xl overflow-hidden mb-8">
        <div 
          ref={scrollRef}
          className="flex-1 space-y-6 p-6 pb-2 scroll-smooth"
        >
          {messages.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-center p-12 opacity-40">
              <div className="w-16 h-16 bg-red-50 rounded-2xl flex items-center justify-center text-red-600 mb-4">
                <PlusCircle className="w-8 h-8" />
              </div>
              <h3 className="text-xl font-sans font-bold text-slate-900 mb-2">How can I help you today?</h3>
              <p className="text-sm max-w-xs">Describe your symptoms or ask a health-related question to get started.</p>
            </div>
          )}
          {messages.map((msg, i) => {
            const isMatch = searchQuery && msg.content.toLowerCase().includes(searchQuery.toLowerCase());
            
            return (
              <div 
                key={i}
                className={cn(
                  "flex flex-col max-w-[85%] animate-in fade-in slide-in-from-bottom-2 duration-300",
                  msg.role === 'user' ? "ml-auto items-end" : "mr-auto items-start",
                  isMatch ? "ring-2 ring-yellow-400 ring-offset-2 rounded-2xl" : ""
                )}
              >
                <div 
                  className={cn(
                    "p-5 rounded-2xl font-sans text-[17px] leading-relaxed shadow-sm",
                    msg.role === 'user' 
                      ? "bg-blue-600 text-white rounded-tr-none" 
                      : "bg-slate-50 text-slate-900 rounded-tl-none border border-slate-100"
                  )}
                >
                  {msg.file && (
                    <div className="mb-3 p-2 bg-black/10 rounded-lg flex items-center gap-2 text-xs">
                      <Paperclip className="w-3 h-3" />
                      <span>{msg.file.name}</span>
                    </div>
                  )}
                  <div className="prose prose-slate max-w-none prose-p:my-0 prose-headings:my-2">
                    <Markdown>{msg.content}</Markdown>
                  </div>
                </div>
                <span className="text-[10px] text-slate-400 mt-1 uppercase tracking-widest font-semibold">
                  {format(new Date(msg.timestamp), 'h:mm a')}
                </span>
              </div>
            );
          })}

          {loading && (
            <div className="flex items-center gap-3 text-blue-600/60 font-sans animate-pulse">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span>MedAssist is analyzing...</span>
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
          <div className="px-6 py-3 bg-blue-50/50 border-t border-blue-100 flex items-center justify-between animate-in fade-in slide-in-from-bottom-2">
            <div className="flex items-center gap-3">
              <UserPlus className="w-5 h-5 text-blue-600" />
              <div className="flex flex-col">
                <span className="text-[10px] font-sans font-bold text-blue-900 uppercase tracking-widest">Recommended Experts:</span>
                <div className="flex gap-2 mt-0.5">
                  {recommendedDoctors.slice(0, 3).map(doc => (
                    <span key={doc.id} className="text-[9px] bg-white px-2 py-0.5 rounded-full border border-blue-200 text-blue-700 font-bold">
                      {doc.name}
                    </span>
                  ))}
                </div>
              </div>
            </div>
            <button 
              onClick={() => setShowDoctorModal(true)}
              className="text-[10px] font-bold uppercase tracking-widest text-blue-600 hover:text-blue-700 transition-colors"
            >
              Connect Now
            </button>
          </div>
        )}

        <form onSubmit={handleSubmit} className="p-4 bg-slate-50/50 border-t border-slate-100 relative sticky bottom-0 z-10 backdrop-blur-md">
          <div className="bg-white rounded-2xl p-1.5 shadow-sm border border-slate-200 flex items-end gap-2">
            <div className="flex-1 relative">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Type your symptoms or questions..."
                className="w-full p-3 pr-10 rounded-xl bg-transparent border-none focus:ring-0 outline-none transition-all resize-none text-slate-900 placeholder-slate-400 font-sans text-[16px] min-h-[44px] max-h-[150px]"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSubmit(e as any);
                  }
                }}
                disabled={loading}
              />
              <div className="absolute right-1 bottom-1 flex items-center">
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
                  className="p-2 text-slate-400 hover:text-blue-600 transition-all"
                >
                  <Paperclip className="w-4 h-4" />
                </button>
              </div>
            </div>
            <button
              type="submit"
              disabled={loading || (!input.trim() && !file)}
              className="bg-blue-600 hover:bg-blue-700 text-white p-2.5 rounded-xl shadow-lg shadow-blue-200 transition-all active:scale-95 disabled:opacity-50"
            >
              <Send className="w-5 h-5" />
            </button>
          </div>
          {file && (
            <div className="absolute -top-8 left-4 flex items-center gap-2 bg-blue-600 text-white px-3 py-1 rounded-full text-[9px] font-bold uppercase tracking-wider shadow-md">
              <Paperclip className="w-3 h-3" />
              <span className="truncate max-w-[120px]">{file.name}</span>
              <button onClick={() => setFile(null)} className="hover:text-red-300">
                <X className="w-3 h-3" />
              </button>
            </div>
          )}
        </form>
      </div>

      {showDoctorModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-[32px] w-full max-w-lg p-8 md:p-12 shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between mb-8">
              <h3 className="text-3xl font-sans font-bold text-slate-900 tracking-tight">Select an Expert</h3>
              <button onClick={() => setShowDoctorModal(false)} className="p-2 hover:bg-slate-50 rounded-full transition-all">
                <X className="w-6 h-6 text-slate-400" />
              </button>
            </div>
            
            <p className="text-slate-500 mb-8 font-sans">
              The selected doctor will receive the full chat transcript for review.
            </p>

            <div className="space-y-4">
              {(recommendedDoctors.length > 0 ? recommendedDoctors : MOCK_DOCTORS).map((doc) => (
                <button
                  key={doc.id}
                  onClick={() => handleConnectToExpert(doc)}
                  className="w-full p-6 rounded-2xl border border-slate-100 hover:border-blue-600 hover:bg-blue-50 transition-all text-left flex items-center justify-between group"
                >
                  <div>
                    <p className="font-sans font-bold text-xl text-slate-900">{doc.name}</p>
                    <p className="text-sm text-slate-500">{doc.specialty}</p>
                  </div>
                  <ChevronRight className="w-5 h-5 text-slate-300 group-hover:text-blue-600 group-hover:translate-x-1 transition-all" />
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
