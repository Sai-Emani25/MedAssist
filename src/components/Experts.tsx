import { useState, useEffect } from 'react';
import { User } from 'firebase/auth';
import { db } from '../firebase';
import { collection, getDocs, query, where, orderBy, addDoc } from 'firebase/firestore';
import { handleFirestoreError, OperationType } from '../lib/firestore-errors';
import { recommendSpecialist } from '../services/gemini';
import { Users, Clock, CheckCircle2, MessageSquare, ChevronRight, X, UserPlus, AlertCircle, Sparkles, Stethoscope } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '../lib/utils';

interface ExpertsProps {
  user: User;
}

interface Consultation {
  id: string;
  doctorName: string;
  doctorSpecialty?: string;
  status: 'pending' | 'reviewed';
  timestamp: string;
  transcript: string;
}

const MOCK_DOCTORS = [
  { id: 'dr_smith', name: 'Dr. Sarah Smith', specialty: 'General Physician', tags: ['fever', 'pain', 'flu', 'general'] },
  { id: 'dr_jones', name: 'Dr. Michael Jones', specialty: 'Cardiologist', tags: ['heart', 'chest', 'breathing', 'pressure'] },
  { id: 'dr_patel', name: 'Dr. Anita Patel', specialty: 'Neurologist', tags: ['headache', 'dizziness', 'numbness', 'seizure'] },
  { id: 'dr_chen', name: 'Dr. David Chen', specialty: 'Dermatologist', tags: ['skin', 'rash', 'acne', 'mole'] },
  { id: 'dr_wilson', name: 'Dr. Emily Wilson', specialty: 'Orthopedic Surgeon', tags: ['bone', 'joint', 'muscle', 'fracture'] },
  { id: 'dr_garcia', name: 'Dr. Maria Garcia', specialty: 'Gastroenterologist', tags: ['stomach', 'digestion', 'nausea', 'bowel'] },
  { id: 'dr_lee', name: 'Dr. James Lee', specialty: 'Psychiatrist', tags: ['anxiety', 'depression', 'mental', 'stress'] },
];

export function Experts({ user }: ExpertsProps) {
  const [consultations, setConsultations] = useState<Consultation[]>([]);
  const [loading, setLoading] = useState(true);
  const [recommendedDoctors, setRecommendedDoctors] = useState<typeof MOCK_DOCTORS>([]);
  const [aiRecommendation, setAiRecommendation] = useState<{ specialty: string, reasoning: string } | null>(null);
  const [selectedConsultation, setSelectedConsultation] = useState<Consultation | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        // Fetch consultations
        const q = query(
          collection(db, 'consultations'),
          where('uid', '==', user.uid),
          orderBy('timestamp', 'desc')
        );
        const snapshot = await getDocs(q);
        setConsultations(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Consultation)));

        // Fetch history to recommend doctors
        const historySnapshot = await getDocs(query(
          collection(db, `users/${user.uid}/symptomChecks`),
          orderBy('timestamp', 'desc'),
          where('uid', '==', user.uid)
        ));
        const historyText = historySnapshot.docs.map(doc => doc.data().symptoms + ' ' + doc.data().analysis).join('\n\n');

        // Fetch medical records for context
        const recordsSnapshot = await getDocs(query(
          collection(db, `users/${user.uid}/medicalRecords`),
          orderBy('timestamp', 'desc')
        ));
        const recordsText = recordsSnapshot.docs.map(doc => `[${doc.data().recordType}] ${doc.data().content}`).join('\n\n');
        
        // AI-driven recommendation
        const aiRec = await recommendSpecialist(historyText, recordsText);
        setAiRecommendation({
          specialty: aiRec.recommendedSpecialty,
          reasoning: aiRec.reasoning
        });

        // Filter doctors based on AI recommendation or tags
        const recommended = MOCK_DOCTORS.filter(doc => 
          doc.specialty.toLowerCase() === aiRec.recommendedSpecialty.toLowerCase() ||
          doc.tags.some(tag => historyText.toLowerCase().includes(tag) || recordsText.toLowerCase().includes(tag))
        );
        
        setRecommendedDoctors(recommended.length > 0 ? recommended : MOCK_DOCTORS.slice(0, 3));
      } catch (err) {
        console.error("Error fetching expert data:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [user.uid]);

  return (
    <div className="space-y-12 max-w-6xl mx-auto">
      <header className="text-center">
        <h2 className="text-4xl font-serif text-[#1a1a1a] mb-4">Expert Consultations</h2>
        <p className="text-[#5A5A40]/60 italic font-serif">
          Connect with professionals and track your consultation requests.
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
        {/* Left Column: Recommended Experts */}
        <div className="lg:col-span-1 space-y-6">
          <h3 className="text-xl font-serif text-[#1a1a1a] flex items-center gap-2">
            <UserPlus className="w-5 h-5 text-[#5A5A40]" />
            Recommended for You
          </h3>

          {aiRecommendation && (
            <div className="p-6 bg-blue-50/50 rounded-3xl border border-blue-100 animate-in fade-in slide-in-from-top-4 duration-500">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center text-blue-600">
                  <Sparkles className="w-4 h-4" />
                </div>
                <p className="text-sm font-bold text-blue-900 uppercase tracking-wider">AI Analysis</p>
              </div>
              <p className="text-sm text-blue-800 font-serif italic leading-relaxed">
                "{aiRecommendation.reasoning}"
              </p>
              <div className="mt-4 pt-4 border-t border-blue-100 flex items-center gap-2 text-blue-700">
                <Stethoscope className="w-4 h-4" />
                <span className="text-xs font-bold uppercase tracking-widest">Suggested: {aiRecommendation.specialty}</span>
              </div>
            </div>
          )}

          <div className="space-y-4">
            {recommendedDoctors.map(doc => (
              <div 
                key={doc.id}
                className="p-6 bg-white rounded-3xl border border-[#5A5A40]/10 shadow-sm hover:border-[#5A5A40]/30 transition-all group"
              >
                <div className="flex items-center gap-4 mb-4">
                  <div className="w-12 h-12 rounded-full bg-[#5A5A40]/10 flex items-center justify-center text-[#5A5A40]">
                    <Users className="w-6 h-6" />
                  </div>
                  <div>
                    <p className="font-serif text-lg text-[#1a1a1a]">{doc.name}</p>
                    <p className="text-xs text-[#5A5A40]/60 uppercase tracking-widest">{doc.specialty}</p>
                  </div>
                </div>
                <button className="w-full py-3 rounded-xl bg-[#5A5A40]/5 text-[#5A5A40] text-sm font-bold uppercase tracking-widest hover:bg-[#5A5A40] hover:text-white transition-all">
                  Book Consultation
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Right Column: Consultation History */}
        <div className="lg:col-span-2 space-y-6">
          <h3 className="text-xl font-serif text-[#1a1a1a] flex items-center gap-2">
            <Clock className="w-5 h-5 text-[#5A5A40]" />
            Request History
          </h3>
          
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-8 h-8 animate-spin text-[#5A5A40]/20" />
            </div>
          ) : consultations.length === 0 ? (
            <div className="text-center py-20 bg-white rounded-[32px] border border-dashed border-[#5A5A40]/20">
              <MessageSquare className="w-12 h-12 text-[#5A5A40]/10 mx-auto mb-4" />
              <p className="text-[#5A5A40]/40 font-serif italic">No consultation requests yet.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {consultations.map(con => (
                <div 
                  key={con.id}
                  onClick={() => setSelectedConsultation(con)}
                  className="p-6 bg-white rounded-3xl border border-[#5A5A40]/10 shadow-sm hover:shadow-md transition-all cursor-pointer flex items-center justify-between group"
                >
                  <div className="flex items-center gap-6">
                    <div className={cn(
                      "w-12 h-12 rounded-2xl flex items-center justify-center",
                      con.status === 'pending' ? "bg-amber-50 text-amber-600" : "bg-green-50 text-green-600"
                    )}>
                      {con.status === 'pending' ? <Clock className="w-6 h-6" /> : <CheckCircle2 className="w-6 h-6" />}
                    </div>
                    <div>
                      <p className="font-serif text-xl text-[#1a1a1a]">Consultation with {con.doctorName}</p>
                      <div className="flex items-center gap-2 mt-1">
                        {con.doctorSpecialty && (
                          <span className="text-[10px] font-bold uppercase tracking-widest text-[#5A5A40]/40 px-2 py-0.5 bg-[#5A5A40]/5 rounded-full">
                            {con.doctorSpecialty}
                          </span>
                        )}
                        <p className="text-sm text-[#5A5A40]/60">
                          Requested on {format(new Date(con.timestamp), 'MMM d, yyyy • h:mm a')}
                        </p>
                      </div>
                    </div>
                  </div>
                  <ChevronRight className="w-6 h-6 text-[#5A5A40]/20 group-hover:text-[#5A5A40] group-hover:translate-x-1 transition-all" />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {selectedConsultation && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-[32px] w-full max-w-3xl max-h-[90vh] overflow-y-auto p-8 md:p-12 shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between mb-8">
              <div>
                <h3 className="text-3xl font-serif text-[#1a1a1a]">Request Details</h3>
                <div className="flex items-center gap-2 mt-1">
                  <p className="text-[#5A5A40]/60 font-serif italic">With {selectedConsultation.doctorName}</p>
                  {selectedConsultation.doctorSpecialty && (
                    <span className="text-[10px] font-bold uppercase tracking-widest text-[#5A5A40]/40 px-2 py-0.5 bg-[#5A5A40]/5 rounded-full">
                      {selectedConsultation.doctorSpecialty}
                    </span>
                  )}
                </div>
              </div>
              <button onClick={() => setSelectedConsultation(null)} className="p-2 hover:bg-[#f5f5f0] rounded-full transition-all">
                <X className="w-6 h-6 text-[#5A5A40]" />
              </button>
            </div>

            <div className="space-y-8">
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 bg-white rounded-2xl border border-[#5A5A40]/10">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-[#5A5A40]/40 mb-1">Status</p>
                  <div className="flex items-center gap-2">
                    <div className={cn(
                      "w-2 h-2 rounded-full",
                      selectedConsultation.status === 'pending' ? "bg-amber-400" : "bg-green-400"
                    )} />
                    <p className="font-serif text-[#1a1a1a] capitalize">{selectedConsultation.status}</p>
                  </div>
                </div>
                <div className="p-4 bg-white rounded-2xl border border-[#5A5A40]/10">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-[#5A5A40]/40 mb-1">Date Requested</p>
                  <p className="font-serif text-[#1a1a1a]">{format(new Date(selectedConsultation.timestamp), 'MMM d, yyyy')}</p>
                </div>
              </div>
              <div className="p-6 bg-[#f5f5f0] rounded-2xl border border-[#5A5A40]/5">
                <h4 className="text-xs font-bold uppercase tracking-widest text-[#5A5A40] mb-4">Shared Transcript</h4>
                <div className="whitespace-pre-wrap font-serif text-[#1a1a1a] leading-relaxed">
                  {selectedConsultation.transcript}
                </div>
              </div>

              <div className="flex items-center gap-4 p-6 bg-amber-50 rounded-2xl border border-amber-100 text-amber-800">
                <AlertCircle className="w-6 h-6" />
                <p className="text-sm font-serif italic">
                  This request is currently <strong>{selectedConsultation.status}</strong>. The doctor will review the transcript and contact you via your registered email.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Loader2(props: any) {
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
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}
