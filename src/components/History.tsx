import { useState, useEffect } from 'react';
import { User } from 'firebase/auth';
import { db } from '../firebase';
import { collection, getDocs, query, orderBy, deleteDoc, doc, addDoc } from 'firebase/firestore';
import { handleFirestoreError, OperationType } from '../lib/firestore-errors';
import Markdown from 'react-markdown';
import { History as HistoryIcon, Trash2, Loader2, Calendar, ChevronRight, AlertTriangle, UserPlus, CheckCircle2, X } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '../lib/utils';

interface HistoryProps {
  user: User;
}

interface SymptomCheck {
  id: string;
  title?: string;
  symptoms: string;
  analysis: string;
  timestamp: string;
  isEmergency: boolean;
}

const MOCK_DOCTORS = [
  { id: 'dr_smith', name: 'Dr. Sarah Smith', specialty: 'General Physician' },
  { id: 'dr_jones', name: 'Dr. Michael Jones', specialty: 'Cardiologist' },
  { id: 'dr_patel', name: 'Dr. Anita Patel', specialty: 'Neurologist' },
];

export function History({ user }: HistoryProps) {
  const [checks, setChecks] = useState<SymptomCheck[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCheck, setSelectedCheck] = useState<SymptomCheck | null>(null);
  const [showDoctorModal, setShowDoctorModal] = useState(false);
  const [consultationSent, setConsultationSent] = useState<Record<string, boolean>>({});

  const fetchHistory = async () => {
    const path = `users/${user.uid}/symptomChecks`;
    try {
      const q = query(collection(db, path), orderBy('timestamp', 'desc'));
      const snapshot = await getDocs(q);
      setChecks(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as SymptomCheck)));
    } catch (err) {
      console.error("Error fetching history:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHistory();
  }, [user.uid]);

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const path = `users/${user.uid}/symptomChecks/${id}`;
    try {
      await deleteDoc(doc(db, `users/${user.uid}/symptomChecks`, id));
      setChecks(checks.filter(c => c.id !== id));
      if (selectedCheck?.id === id) setSelectedCheck(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, path);
    }
  };

  const handleConnectToExpert = async (doctor: typeof MOCK_DOCTORS[0]) => {
    if (!selectedCheck) return;

    const path = `consultations`;
    try {
      await addDoc(collection(db, path), {
        uid: user.uid,
        doctorId: doctor.id,
        doctorName: doctor.name,
        checkId: selectedCheck.id,
        transcript: `Symptoms: ${selectedCheck.symptoms}\n\nAI Analysis: ${selectedCheck.analysis}`,
        status: 'pending',
        timestamp: new Date().toISOString()
      });
      setConsultationSent(prev => ({ ...prev, [selectedCheck.id]: true }));
      setShowDoctorModal(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, path);
    }
  };

  return (
    <div className="space-y-8">
      <header className="text-center mb-12">
        <h2 className="text-4xl font-serif text-[#1a1a1a] mb-4">Check History</h2>
        <p className="text-[#5A5A40]/60 italic font-serif">
          Review your past symptom checks and AI insights.
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className={cn("lg:col-span-5 space-y-4", selectedCheck && "hidden lg:block")}>
          {loading ? (
            <div className="flex justify-center py-20">
              <Loader2 className="w-8 h-8 animate-spin text-[#5A5A40]" />
            </div>
          ) : checks.length === 0 ? (
            <div className="bg-white rounded-[32px] p-12 text-center border border-[#5A5A40]/10">
              <HistoryIcon className="w-12 h-12 text-[#5A5A40]/20 mx-auto mb-4" />
              <p className="text-[#5A5A40]/60 italic font-serif">No history yet.</p>
            </div>
          ) : (
            checks.map((check) => (
              <button
                key={check.id}
                onClick={() => setSelectedCheck(check)}
                className={cn(
                  "w-full bg-white rounded-3xl p-6 shadow-sm border transition-all text-left group relative",
                  selectedCheck?.id === check.id
                    ? "border-[#5A5A40] ring-1 ring-[#5A5A40]/20"
                    : "border-[#5A5A40]/10 hover:border-[#5A5A40]/30"
                )}
              >
                <div className="flex items-start justify-between gap-4 mb-3">
                  <div className="flex items-center gap-2 text-xs text-[#5A5A40]/60 font-serif italic">
                    <Calendar className="w-3 h-3" />
                    {format(new Date(check.timestamp), 'MMM d, yyyy • h:mm a')}
                  </div>
                  {check.isEmergency && (
                    <AlertTriangle className="w-4 h-4 text-red-500" />
                  )}
                </div>
                <p className="text-[#1a1a1a] font-serif font-bold text-lg line-clamp-1 mb-1 pr-8">
                  {check.title || "Symptom Check"}
                </p>
                <p className="text-[#5A5A40]/70 font-serif line-clamp-1 mb-4 pr-8 text-sm italic">
                  {check.symptoms}
                </p>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase tracking-widest text-[#5A5A40]/60 font-bold">View Details</span>
                  <ChevronRight className="w-4 h-4 text-[#5A5A40]/40 group-hover:translate-x-1 transition-transform" />
                </div>
                <button
                  onClick={(e) => handleDelete(check.id, e)}
                  className="absolute top-6 right-6 p-2 text-[#5A5A40]/20 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </button>
            ))
          )}
        </div>

        <div className={cn("lg:col-span-7", !selectedCheck && "hidden lg:flex items-center justify-center")}>
          {selectedCheck ? (
            <div className="bg-white rounded-[32px] p-8 md:p-12 shadow-sm border border-[#5A5A40]/10 sticky top-8 animate-in fade-in slide-in-from-right-4 duration-500">
              <button 
                onClick={() => setSelectedCheck(null)}
                className="lg:hidden mb-6 text-[#5A5A40] flex items-center gap-2 font-serif italic"
              >
                <ChevronRight className="w-4 h-4 rotate-180" />
                Back to list
              </button>

              <div className="space-y-8">
                <section>
                  <h3 className="text-2xl font-serif text-[#1a1a1a] mb-2">{selectedCheck.title || "Symptom Check"}</h3>
                  <span className="text-[10px] uppercase tracking-widest text-[#5A5A40]/60 font-bold block mb-4">Reported Symptoms</span>
                  <div className="p-6 bg-[#f5f5f0]/50 rounded-2xl border border-[#5A5A40]/5 text-[#1a1a1a] font-serif text-lg italic">
                    "{selectedCheck.symptoms}"
                  </div>
                </section>

                <section>
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-[10px] uppercase tracking-widest text-[#5A5A40]/60 font-bold">AI Analysis</span>
                    {selectedCheck.isEmergency && (
                      <div className="flex items-center gap-2 text-red-600 text-xs font-bold uppercase tracking-wider bg-red-50 px-3 py-1 rounded-full">
                        <AlertTriangle className="w-3 h-3" />
                        Emergency Flagged
                      </div>
                    )}
                  </div>
                  <div className="prose prose-stone max-w-none prose-headings:font-serif prose-p:font-serif prose-p:text-lg prose-p:leading-relaxed text-[#1a1a1a]">
                    <Markdown>{selectedCheck.analysis}</Markdown>
                  </div>
                </section>

                <div className="pt-8 border-t border-[#5A5A40]/10 flex flex-col md:flex-row items-center justify-between gap-6">
                  <div className="flex items-center gap-3 text-[#5A5A40]/60 italic font-serif text-sm">
                    <AlertTriangle className="w-4 h-4" />
                    <p>Need professional verification?</p>
                  </div>
                  
                  {consultationSent[selectedCheck.id] ? (
                    <div className="flex items-center gap-2 text-green-700 font-medium bg-green-50 px-6 py-3 rounded-full border border-green-200 text-sm">
                      <CheckCircle2 className="w-4 h-4" />
                      Sent to expert
                    </div>
                  ) : (
                    <button
                      onClick={() => setShowDoctorModal(true)}
                      className="bg-[#5A5A40] hover:bg-[#4A4A30] text-white px-6 py-3 rounded-full flex items-center gap-2 shadow-md transition-all active:scale-95 text-sm"
                    >
                      <UserPlus className="w-4 h-4" />
                      Connect to Expert
                    </button>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center py-20">
              <HistoryIcon className="w-16 h-16 text-[#5A5A40]/10 mx-auto mb-6" />
              <p className="text-[#5A5A40]/40 font-serif italic text-lg">Select a check from the history to view details.</p>
            </div>
          )}
        </div>
      </div>

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
              The selected doctor will receive a full transcript of this symptom check for review.
            </p>

            <div className="space-y-4">
              {MOCK_DOCTORS.map((doc) => (
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
